import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface PublicUser {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: number;
  lastLoginAt: number | null;
}

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<PublicUser>;
  register: (email: string, password: string) => Promise<PublicUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(init || {}),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const msg = data?.message || (res.status === 401 ? "Unauthorized" : `Request failed (${res.status})`);
    throw new Error(msg);
  }
  return data as T;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      const data = await api<{ user: PublicUser | null }>("/api/auth/me");
      setUser(data.user ?? null);
      setError(null);
    } catch (e: any) {
      setUser(null);
      setError(e?.message || "Failed to load session");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const login = async (email: string, password: string) => {
    const data = await api<{ user: PublicUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setUser(data.user);
    setError(null);
    return data.user;
  };

  const register = async (email: string, password: string) => {
    const data = await api<{ user: PublicUser }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setUser(data.user);
    setError(null);
    return data.user;
  };

  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
    } finally {
      setUser(null);
    }
  };

  const value: AuthContextValue = { user, loading, error, login, register, logout, refresh };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
