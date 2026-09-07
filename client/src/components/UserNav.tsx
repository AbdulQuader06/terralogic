import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { Loader2, LogOut } from "lucide-react";
import { useState } from "react";

export default function UserNav({ className = "" }: { className?: string }) {
  const { user, loading, logout } = useAuth();
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    try {
      setBusy(true);
      await logout();
      window.location.assign("/login");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !user) {
    return <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…</div>;
  }
  if (!user) return null;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="hidden sm:block text-xs text-muted-foreground font-medium truncate max-w-[200px]">
        {user.email}
      </span>
      <Badge
        variant="outline"
        className={`h-6 text-[10px] px-2 tracking-widest uppercase ${
          user.role === "admin"
            ? "bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300"
            : "bg-sky-50 text-sky-700 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300"
        }`}
      >
        {user.role}
      </Badge>
      <Button
        size="sm"
        variant="ghost"
        onClick={onLogout}
        disabled={busy}
        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
        title="Sign out"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5 mr-1" />}
        {!busy && <span className="hidden sm:inline">Logout</span>}
      </Button>
    </div>
  );
}
