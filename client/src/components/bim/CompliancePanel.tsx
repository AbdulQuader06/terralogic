import { useState, useEffect, useRef, useCallback } from "react";
import type { BimMetrics } from "./BimViewport";
import type { SiteData } from "./SiteSelector";

interface ComplianceResult {
  compliant: boolean;
  score: number;
  violations: { code: string; description: string; severity: "critical" | "warning" | "info" }[];
  recommendations: string[];
  solarExposure: number;
  zoningSummary: string;
}

interface CompliancePanelProps {
  siteData: SiteData | null;
  metrics: BimMetrics | null;
  massings: any[];
  sunHour: number;
  onScoreUpdate?: (score: number) => void;
}

export default function CompliancePanel({ siteData, metrics, massings, sunHour, onScoreUpdate }: CompliancePanelProps) {
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const checkCompliance = useCallback(async () => {
    if (!siteData || !metrics || massings.length === 0) {
      setResult(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const siteProfile = {
        location: siteData.center,
        elevation: siteData.elevation,
        siteArea: siteData.area,
        amenities: siteData.amenities,
        massings: massings.map(m => ({
          type: m.type,
          width: m.width,
          depth: m.depth,
          height: m.height,
          floors: m.floors,
          footprint: m.footprintArea,
          builtUp: m.totalFloorArea,
        })),
        metrics: {
          far: metrics.far,
          groundCoverage: metrics.groundCoverage,
          openSpace: metrics.openSpace,
          totalBuiltUp: metrics.totalBuiltUp,
          maxHeight: metrics.maxHeight,
          massingCount: metrics.massingCount,
        },
        sunHour,
      };

      const resp = await fetch("/api/bim/compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(siteProfile),
      });

      if (!resp.ok) throw new Error("Compliance check failed");

      const data = await resp.json();
      setResult(data);
      onScoreUpdate?.(data.score || 0);
    } catch (e: any) {
      setError(e.message || "Failed to check compliance");
    } finally {
      setLoading(false);
    }
  }, [siteData, metrics, massings, sunHour]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(checkCompliance, 1500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [checkCompliance]);

  const borderColor = !result ? "border-gray-800" : result.compliant ? "border-green-500/50" : "border-red-500/50";
  const bgGlow = !result ? "" : result.compliant ? "shadow-[0_0_20px_rgba(0,255,100,0.05)]" : "shadow-[0_0_20px_rgba(255,0,0,0.08)]";

  return (
    <div className={`bg-black/80 border ${borderColor} rounded-lg backdrop-blur-sm overflow-hidden transition-all ${bgGlow}`} data-testid="compliance-panel">
      <div className={`px-3 py-2 border-b ${borderColor} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${!result ? "bg-gray-600" : result.compliant ? "bg-green-500 animate-pulse" : "bg-red-500 animate-pulse"}`} />
          <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">NBC Compliance</h3>
        </div>
        {result && (
          <div className={`text-[10px] font-bold ${result.compliant ? "text-green-400" : "text-red-400"}`}>
            {result.score}/100
          </div>
        )}
      </div>

      <div className="p-3 space-y-3 max-h-[400px] overflow-y-auto">
        {!siteData || !metrics || massings.length === 0 ? (
          <div className="text-[11px] text-gray-600 text-center py-4">
            Place massing boxes to begin compliance checking
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-6">
            <div className="text-center space-y-2">
              <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <div className="text-[10px] text-cyan-400">Analyzing NBC compliance...</div>
            </div>
          </div>
        ) : error ? (
          <div className="text-[11px] text-red-400 bg-red-500/5 rounded p-2 border border-red-500/20">
            {error}
          </div>
        ) : result ? (
          <>
            <div className={`rounded-lg p-2.5 ${result.compliant ? "bg-green-500/5 border border-green-500/20" : "bg-red-500/5 border border-red-500/20"}`}>
              <div className={`text-xs font-semibold ${result.compliant ? "text-green-400" : "text-red-400"}`}>
                {result.compliant ? "✓ COMPLIANT" : "✗ NON-COMPLIANT"}
              </div>
              <div className="text-[10px] text-gray-400 mt-1">{result.zoningSummary}</div>
            </div>

            {result.violations.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Violations</div>
                {result.violations.map((v, i) => (
                  <div key={i} className={`rounded p-2 border text-[10px] ${
                    v.severity === "critical" ? "bg-red-500/5 border-red-500/20 text-red-300" :
                    v.severity === "warning" ? "bg-yellow-500/5 border-yellow-500/20 text-yellow-300" :
                    "bg-blue-500/5 border-blue-500/20 text-blue-300"
                  }`}>
                    <div className="font-medium">{v.code}</div>
                    <div className="text-gray-400 mt-0.5">{v.description}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Solar Analysis</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-800 rounded-full h-2">
                  <div className="h-2 rounded-full transition-all" style={{
                    width: `${result.solarExposure}%`,
                    backgroundColor: result.solarExposure >= 75 ? "#22c55e" : result.solarExposure >= 50 ? "#eab308" : "#ef4444",
                  }} />
                </div>
                <span className={`text-[10px] font-medium ${result.solarExposure >= 75 ? "text-green-400" : "text-yellow-400"}`}>
                  {result.solarExposure}%
                </span>
              </div>
              <div className="text-[10px] text-gray-500">Target: 75% | {result.solarExposure >= 75 ? "Achieved" : `${75 - result.solarExposure}% below target`}</div>
            </div>

            {result.recommendations.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Recommendations</div>
                {result.recommendations.map((r, i) => (
                  <div key={i} className="text-[10px] text-cyan-300/80 bg-cyan-500/5 rounded p-2 border border-cyan-500/10">
                    {r}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
