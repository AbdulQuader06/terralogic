import crypto from "node:crypto";
import type { Request, Response, NextFunction, Express } from "express";
import { z } from "zod";
import { storage } from "./storage";

export type Role = "admin" | "user";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: number;
  lastLoginAt?: number;
}

export interface Session {
  id: string;
  userId: string;
  role: Role;
  email: string;
  createdAt: number;
  expiresAt: number;
}

declare global {
  namespace Express {
    interface Request {
      session?: Session | null;
      user?: User | null;
    }
  }
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 100_000;
const SESSION_COOKIE = "tl_session";

export function hashPassword(plaintext: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(
    plaintext.normalize("NFKC"),
    salt,
    PBKDF2_ITERATIONS,
    64,
    "sha512",
  );
  return [
    String(PBKDF2_ITERATIONS),
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export function verifyPassword(plaintext: string, hash: string): boolean {
  const [iterStr, saltB64, expectedB64] = hash.split("$");
  if (!iterStr || !saltB64 || !expectedB64) return false;
  try {
    const iters = parseInt(iterStr, 10);
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(expectedB64, "base64");
    const actual = crypto.pbkdf2Sync(
      plaintext.normalize("NFKC"),
      salt,
      iters,
      expected.length,
      "sha512",
    );
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const HMAC_KEY_BYTES = 32;
function hmacKey(): Buffer {
  const base = process.env.SESSION_SECRET || "terralogic-dev-secret-change-me-please";
  return crypto.createHash("sha256").update(base).digest();
}

function sign(payload: string): string {
  const mac = crypto
    .createHmac("sha256", hmacKey())
    .update(payload)
    .digest("base64url");
  return `${payload}.${mac}`;
}

function unsign(signed: string): string | null {
  const dot = signed.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = signed.slice(0, dot);
  const mac = signed.slice(dot + 1);
  const expected = crypto
    .createHmac("sha256", hmacKey())
    .update(payload)
    .digest("base64url");
  if (mac.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return payload;
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}
function base64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function setSessionCookie(res: Response, token: string, expiresAt: number) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie?.(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    expires: new Date(expiresAt),
  });
}

function clearSessionCookie(res: Response) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie?.(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    expires: new Date(0),
  });
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  cookieHeader.split(";").forEach(part => {
    const eq = part.indexOf("=");
    if (eq === -1) return;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  });
  return out;
}

function genId(prefix = ""): string {
  return prefix + base64urlEncode(crypto.randomBytes(12));
}

export async function createSessionForUser(user: User): Promise<{ session: Session; token: string }> {
  const now = Date.now();
  const session: Session = {
    id: genId("s_"),
    userId: user.id,
    role: user.role,
    email: user.email,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  await storage.createSession(session);
  const payload = Buffer.from(JSON.stringify({ sid: session.id })).toString("base64url");
  const token = sign(payload);
  return { session, token };
}

export async function getSessionFromReq(req: Request): Promise<Session | null> {
  const cookies = parseCookieHeader(req.headers.cookie);
  const tok = cookies[SESSION_COOKIE];
  if (!tok) return null;
  const payload = unsign(tok);
  if (!payload) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const sid: string = data.sid;
    const s = await storage.getSession(sid);
    if (!s) return null;
    if (s.expiresAt < Date.now()) {
      await storage.deleteSession(sid);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function authMiddleware(required: boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const s = await getSessionFromReq(req);
      req.session = s;
      if (s) {
        const user = await storage.getUser(s.userId);
        req.user = user || null;
      } else {
        req.user = null;
      }
      if (required && !s) {
        return res.status(401).json({ message: "Authentication required" });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session) return res.status(401).json({ message: "Authentication required" });
    if (!roles.includes(req.session.role)) {
      return res.status(403).json({ message: `Role required: ${roles.join(" or ")}` });
    }
    next();
  };
}

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: z.string().min(1).max(200),
});

type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();
function rateLimit(keyPrefix: string, limit: number, windowMs: number, ip: string): boolean {
  const key = `${keyPrefix}:${ip}`;
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || b.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (v.resetAt < now) rateBuckets.delete(k);
  storage.cleanupExpiredSessions().catch(() => {});
}, 60_000);

function ipOf(req: Request): string {
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return fwd || req.socket.remoteAddress || "unknown";
}

export function registerAuthRoutes(app: Express) {
  app.use("/api/auth", (req, _res, next) => {
    const ip = ipOf(req);
    if (!rateLimit("auth", 20, 60_000, ip)) {
      _res.status(429).json({ message: "Too many authentication requests. Try again in 1 minute." });
      return;
    }
    next();
  });

  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid input" });
      }
      const { email, password } = parsed.data;
      const existing = await storage.findUserByEmail(email);
      if (existing) return res.status(409).json({ message: "An account with this email already exists." });
      const count = await storage.userCount();
      const role: Role = count === 0 ? "admin" : "user";
      const user: User = {
        id: genId("u_"),
        email,
        passwordHash: hashPassword(password),
        role,
        createdAt: Date.now(),
      };
      await storage.createUser(user);
      const { session, token } = await createSessionForUser(user);
      await storage.updateUser(user.id, { lastLoginAt: Date.now() });
      setSessionCookie(res, token, session.expiresAt);
      return res.status(201).json({
        user: publicUser(user),
        message: count === 0 ? "Admin account created." : "Account created.",
      });
    } catch (e) { next(e); }
  });

  app.post("/api/auth/login", async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid email or password." });
      const { email, password } = parsed.data;
      const user = await storage.findUserByEmail(email);
      if (!user) return res.status(401).json({ message: "Invalid email or password." });
      if (!verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      await storage.updateUser(user.id, { lastLoginAt: Date.now() });
      const { session, token } = await createSessionForUser(user);
      setSessionCookie(res, token, session.expiresAt);
      return res.json({ user: publicUser(user) });
    } catch (e) { next(e); }
  });

  app.post("/api/auth/logout", authMiddleware(false), async (req, res, next) => {
    try {
      if (req.session) await storage.deleteSession(req.session.id);
      clearSessionCookie(res);
      return res.json({ ok: true });
    } catch (e) { next(e); }
  });

  app.get("/api/auth/me", authMiddleware(false), async (req, res, next) => {
    try {
      if (!req.session || !req.user) return res.status(200).json({ user: null });
      return res.json({ user: publicUser(req.user), csrfToken: null });
    } catch (e) { next(e); }
  });
}

function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt ?? null,
  };
}
