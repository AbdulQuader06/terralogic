import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";

export default function RegisterPage() {
  const { register, user, loading } = useAuth();
  const [, navigate] = useLocation();
  const search = new URLSearchParams(window.location.search);
  const returnTo = search.get("returnTo") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) navigate(returnTo, { replace: true });
  }, [user, loading, navigate, returnTo]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    try {
      setSubmitting(true);
      await register(email.trim(), password);
      navigate(returnTo, { replace: true });
    } catch (err: any) {
      setError(err?.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 via-emerald-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl border-border/60">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-600/15 border border-emerald-600/30 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <CardTitle className="text-xl tracking-tight">Create your account</CardTitle>
              <CardDescription className="text-sm">Start designing with TerraLogic AI</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <Label htmlFor="email">Work email</Label>
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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="h-9 mt-1.5"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="confirm">Confirm password</Label>
                <Badge variant="outline" className="text-[10px] h-5">
                  {password && confirm
                    ? password === confirm ? "Match ✓" : "Don't match"
                    : "PBKDF2 hashing"}
                </Badge>
              </div>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="h-9 mt-1.5"
                placeholder="Re-type password"
              />
            </div>
            {error && (
              <div className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 p-2.5 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <Button type="submit" disabled={submitting || loading} className="w-full h-9 text-sm">
              {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating account…</> : "Create account"}
            </Button>
          </form>
          <div className="text-center text-xs text-muted-foreground">
            Already have an account?{" "}
            <Link to={`/login${window.location.search}`} className="text-primary hover:underline font-medium">
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
