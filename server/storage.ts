import fs from "node:fs";
import path from "node:path";
import type { SiteAnalysis } from "@shared/schema";
import type { User, Session } from "./auth";

export interface IStorage {
  getAnalysis(key: string): Promise<SiteAnalysis | undefined>;
  saveAnalysis(key: string, analysis: SiteAnalysis): Promise<void>;
  createUser(user: User): Promise<void>;
  getUser(id: string): Promise<User | undefined>;
  findUserByEmail(email: string): Promise<User | undefined>;
  updateUser(id: string, patch: Partial<User>): Promise<void>;
  userCount(): Promise<number>;
  listUsers(): Promise<User[]>;
  createSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | undefined>;
  deleteSession(id: string): Promise<void>;
  cleanupExpiredSessions(): Promise<number>;
  saveToDisk(): Promise<void>;
  shutdown(): Promise<void>;
  getAllAnalyses(): Promise<Array<{ key: string; analysis: SiteAnalysis }>>;
}

interface PersistedSnapshot {
  users: User[];
  sessions: Session[];
  analyses: Array<{ key: string; analysis: SiteAnalysis }>;
  savedAt: number;
}

function snapshotPath(): string {
  const root = process.cwd();
  const dir = path.join(root, ".data");
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* ignore */ }
  }
  return path.join(dir, "storage.json");
}

function readSnapshot(): PersistedSnapshot | null {
  const p = snapshotPath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as PersistedSnapshot;
  } catch (e) {
    console.warn("[storage] Failed to read snapshot, starting empty:", (e as Error).message);
    return null;
  }
}

export class MemStorage implements IStorage {
  private analyses: Map<string, SiteAnalysis>;
  private users: Map<string, User>;
  private userEmailIndex: Map<string, string>; // lower(email) -> user id
  private sessions: Map<string, Session>;
  private dirty = false;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(autosaveMs = 30_000) {
    const snap = readSnapshot();
    this.analyses = new Map(snap?.analyses?.map((a: any) => [a.key, a.analysis]) || []);
    this.users = new Map(snap?.users?.map((u: User) => [u.id, u]) || []);
    this.userEmailIndex = new Map();
    for (const u of this.users.values()) this.userEmailIndex.set(u.email.toLowerCase(), u.id);
    this.sessions = new Map(snap?.sessions?.map((s: Session) => [s.id, s]) || []);
    this.markDirty();
    if (autosaveMs > 0) {
      this.autosaveTimer = setInterval(() => { void this.autosaveTick(); }, autosaveMs);
      if (typeof this.autosaveTimer.unref === "function") this.autosaveTimer.unref();
    }
  }

  private markDirty() { this.dirty = true; }

  private async autosaveTick() {
    if (!this.dirty) return;
    try { await this.saveToDisk(); } catch (e) { console.warn("[storage] autosave failed:", e); }
  }

  async saveToDisk() {
    const snapshot: PersistedSnapshot = {
      users: Array.from(this.users.values()),
      sessions: Array.from(this.sessions.values()),
      analyses: Array.from(this.analyses.entries()).map(([key, analysis]) => ({ key, analysis })),
      savedAt: Date.now(),
    };
    const p = snapshotPath();
    const tmp = `${p}.${process.pid}.tmp`;
    const payload = JSON.stringify(snapshot, null, 0);
    await fs.promises.writeFile(tmp, payload, { encoding: "utf8", mode: 0o600 });
    await fs.promises.rename(tmp, p);
    this.dirty = false;
  }

  async shutdown() {
    if (this.autosaveTimer) { clearInterval(this.autosaveTimer); this.autosaveTimer = null; }
    try { await this.saveToDisk(); } catch { /* ignore */ }
  }

  async getAnalysis(key: string): Promise<SiteAnalysis | undefined> {
    return this.analyses.get(key);
  }

  async saveAnalysis(key: string, analysis: SiteAnalysis): Promise<void> {
    this.analyses.set(key, analysis);
    this.markDirty();
  }

  async getAllAnalyses(): Promise<Array<{ key: string; analysis: SiteAnalysis }>> {
    return Array.from(this.analyses.entries()).map(([key, analysis]) => ({ key, analysis }));
  }

  async createUser(user: User): Promise<void> {
    this.users.set(user.id, user);
    this.userEmailIndex.set(user.email.toLowerCase(), user.id);
    this.markDirty();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async findUserByEmail(email: string): Promise<User | undefined> {
    const id = this.userEmailIndex.get(email.toLowerCase());
    if (!id) return undefined;
    return this.users.get(id);
  }

  async updateUser(id: string, patch: Partial<User>): Promise<void> {
    const existing = this.users.get(id);
    if (!existing) return;
    const updated: User = { ...existing, ...patch };
    if (patch.email !== undefined && patch.email.toLowerCase() !== existing.email.toLowerCase()) {
      this.userEmailIndex.delete(existing.email.toLowerCase());
      this.userEmailIndex.set(patch.email.toLowerCase(), id);
    }
    this.users.set(id, updated);
    this.markDirty();
  }

  async userCount(): Promise<number> {
    return this.users.size;
  }

  async listUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async createSession(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
    this.markDirty();
  }

  async getSession(id: string): Promise<Session | undefined> {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (s.expiresAt < Date.now()) {
      this.sessions.delete(id);
      this.markDirty();
      return undefined;
    }
    return s;
  }

  async deleteSession(id: string): Promise<void> {
    if (this.sessions.has(id)) { this.sessions.delete(id); this.markDirty(); }
  }

  async cleanupExpiredSessions(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const [id, s] of this.sessions.entries()) {
      if (s.expiresAt < now) { this.sessions.delete(id); removed++; }
    }
    if (removed > 0) this.markDirty();
    return removed;
  }
}

export const storage = new MemStorage(30_000);
