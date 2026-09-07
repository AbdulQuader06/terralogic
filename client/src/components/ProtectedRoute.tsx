import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldAlert } from "lucide-react";

interface Props {
  children: ReactNode;
  roles?: Array<"admin" | "user">;
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { user, loading } = useAuth();
  const [location, navigate] = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen w-full grid place-items-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading session…
        </div>
      </div>
    );
  }

  if (!user) {
    const qs = new URLSearchParams({ returnTo: location }).toString();
    navigate(`/login?${qs}`, { replace: true });
    return null;
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="min-h-screen w-full grid place-items-center p-4 bg-muted/30">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
              <CardTitle className="text-base">Permission denied</CardTitle>
            </div>
            <CardDescription>
              Your role <code className="px-1 rounded bg-muted">{user.role}</code> cannot access this page.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2 flex-wrap">
            <Button variant="default" size="sm" onClick={() => navigate("/", { replace: true })}>Go home</Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/login", { replace: true })}>Sign in as another user</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
