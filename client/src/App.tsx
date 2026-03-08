import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import { lazy, Suspense } from "react";
const BimDesigner = lazy(() => import("@/pages/BimDesigner"));

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/bim">
        <Suspense fallback={<div className="h-screen w-screen bg-[#0d1117] flex items-center justify-center text-cyan-400 text-sm">Loading BIM Designer...</div>}>
          <BimDesigner />
        </Suspense>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;