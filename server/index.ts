import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { registerAuthRoutes } from "./auth";
import { storage } from "./storage";

const app = express();
const httpServer = createServer(app);

// Health check FIRST - before any middleware or slow initialization
app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptimeSec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

const CORS_ORIGINS = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const isProd = process.env.NODE_ENV === "production";
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Accept, X-Requested-With",
    );
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  if (isProd) {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.arcgisonline.com https://*.esri.com https://*.googleapis.com",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "font-src 'self' data:",
        "worker-src 'self' blob:",
        "connect-src 'self' https://*.arcgisonline.com https://*.esri.com https://generativelanguage.googleapis.com https://openai.com https://api.openai.com https://*.open-meteo.com https://overpass-api.de https://overpass.kumi.systems https://maps.mail.ru wss:",
      ].join("; "),
    );
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use(
  express.json({
    limit: "10kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// 415 on /api/* POST/PUT/PATCH non-JSON
app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();
  const ct = (req.headers["content-type"] || "").toLowerCase();
  const method = req.method;
  const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
  if (hasBody && !ct.includes("application/json")) {
    return res.status(415).json({ message: "Unsupported Media Type: expected application/json" });
  }
  next();
});

app.use(express.urlencoded({ extended: false, limit: "100kb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// ---- Rate limiter (sliding window in-memory) ----
type Bucket = { starts: number[]; max: number; windowMs: number };
const rateBuckets = new Map<string, Bucket>();
function hit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b) { b = { starts: [], max, windowMs }; rateBuckets.set(key, b); }
  b.starts = b.starts.filter(t => t + b.windowMs > now);
  if (b.starts.length >= b.max) return false;
  b.starts.push(now);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) {
    b.starts = b.starts.filter(t => t + b.windowMs > now);
    if (b.starts.length === 0) rateBuckets.delete(k);
  }
}, 60_000);
function ipOf(req: Request): string {
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return fwd || req.socket.remoteAddress || "unknown";
}
app.use("/api/chat", (req, res, next) => {
  if (!hit(`chat:${ipOf(req)}`, 30, 60_000)) {
    return res.status(429).json({ message: "Too many chat requests. Slow down." });
  }
  next();
});
app.use("/api/analyze", (req, res, next) => {
  if (!hit(`analyze:${ipOf(req)}`, 20, 60_000)) {
    return res.status(429).json({ message: "Too many analyze requests. Slow down." });
  }
  next();
});
app.use("/api/bim/compliance", (req, res, next) => {
  if (!hit(`bimc:${ipOf(req)}`, 15, 60_000)) {
    return res.status(429).json({ message: "Too many BIM compliance checks. Slow down." });
  }
  next();
});

// Request logger (API only, body never logged)
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  // Auth routes BEFORE registerRoutes (so account creation/login never blocked by API auth)
  registerAuthRoutes(app);

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    if (status >= 500) console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: process.platform === "linux",
    },
    () => {
      log(`serving on port ${port} (${process.env.NODE_ENV || "development"})`);
    },
  );
})();

// Graceful shutdown: persist storage + close server cleanly
let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received: starting graceful shutdown`);
  try {
    await storage.shutdown();
    log("storage flushed to disk");
  } catch (e) {
    console.error("storage shutdown error:", e);
  }
  const shutdownTimer = setTimeout(() => {
    log("shutdown timeout, forcing exit");
    process.exit(exitCode);
  }, 5000);
  httpServer.close(() => {
    clearTimeout(shutdownTimer);
    log("HTTP server closed");
    process.exit(exitCode);
  });
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (e) => {
  console.error("uncaughtException:", e);
  void shutdown("uncaughtException", 1);
});
