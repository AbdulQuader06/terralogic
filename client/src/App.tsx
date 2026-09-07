import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ProtectedRoute from "@/components/ProtectedRoute";
import { AuthProvider } from "@/lib/auth";
import { lazy, Suspense } from "react";
const BimDesigner = lazy(() => import("@/pages/BimDesigner"));

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/">
        <ProtectedRoute roles={["admin", "user"]}>
          <Home />
        </ProtectedRoute>
      </Route>
      <Route path="/bim">
        <ProtectedRoute roles={["admin", "user"]}>
          <Suspense fallback={<div className="h-screen w-screen bg-[#0d1117] flex items-center justify-center text-cyan-400 text-sm">Loading Compliance Checking...</div>}>
            <BimDesigner />
          </Suspense>
        </ProtectedRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;