import { createRoot } from "react-dom/client";
import { Component, useEffect, type ReactNode } from "react";
import App from "./App";
import "./index.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return (
        <div style={{ padding: 32, fontFamily: "sans-serif", background: "#EFF3F6", minHeight: "100vh" }}>
          <h2 style={{ color: "#c0392b", marginBottom: 8 }}>TerraLogic AI — Failed to load</h2>
          <p style={{ color: "#555", marginBottom: 16 }}>A JavaScript error prevented the app from starting. Please reload.</p>
          <pre style={{ background: "#f5f5f5", padding: 16, borderRadius: 8, overflow: "auto", fontSize: 12, color: "#333" }}>
            {err.message}{"\n"}{err.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: "8px 24px", background: "#2C5282", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppWithLoader() {
  useEffect(() => {
    // Remove splash overlay from bundled JS — production CSP (script-src 'self')
    // blocks the inline __removeLoader script in index.html.
    document.getElementById("app-loader")?.remove();
  }, []);
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <AppWithLoader />
  </ErrorBoundary>
);
