import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, Shield } from "lucide-react";

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const [, navigate] = useLocation();
  const search = new URLSearchParams(window.location.search);
  const returnTo = search.get("returnTo") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) navigate(returnTo, { replace: true });
  }, [user, loading, navigate, returnTo]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setSubmitting(true);
      await login(email.trim(), password);
      navigate(returnTo, { replace: true });
    } catch (err: any) {
      setError(err?.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl border-border/60">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl tracking-tight">Sign in to TerraLogic</CardTitle>
              <CardDescription className="text-sm">Urban analysis, BIM compliance &amp; site intelligence</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="h-9 mt-1.5"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Badge variant="outline" className="text-[10px] h-5">PBKDF2 · Signed cookies</Badge>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="h-9 mt-1.5"
                placeholder="At least 8 characters"
              />
            </div>
            {error && (
              <div className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 p-2.5 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <Button type="submit" disabled={submitting || loading} className="w-full h-9 text-sm">
              {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in…</> : "Sign in"}
            </Button>
          </form>
          <div className="text-center text-xs text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link to={`/register${window.location.search}`} className="text-primary hover:underline font-medium">
              Create one
            </Link>
          </div>
          <p className="text-[11px] text-muted-foreground text-center leading-snug">
            The first account registered automatically becomes the administrator.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
