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
  rulesSummary?: string;
  dominantType?: string;
  dynamicLimits?: {
    far: number;
    groundCoverage: number;
    openSpace: number;
    maxHeight: number;
    setbacks?: { front: number; rearSide: number };
  };
  maxEnvelope?: {
    farLimit: number;
    groundCoverageLimit: number;
    openSpaceMinimum: number;
    maxHeightLimit: number;
    setbacks: { front: number; rearSide: number };
    maxFootprintArea: number;
    maxBuiltUpArea: number;
    minOpenSpaceArea: number;
    maxEnvelopeVolume: number;
    theoreticalFloors: number;
    useType: string;
    siteArea: number;
  };
}

interface CompliancePanelProps {
  siteData: SiteData | null;
  metrics: BimMetrics | null;
  massings: any[];
  sunHour: number;
  onScoreUpdate?: (score: number) => void;
  onLimitsUpdate?: (limits: ComplianceResult["dynamicLimits"], envelope?: ComplianceResult["maxEnvelope"]) => void;
}

export default function CompliancePanel({ siteData, metrics, massings, sunHour, onScoreUpdate, onLimitsUpdate }: CompliancePanelProps) {
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (result?.dynamicLimits && onLimitsUpdate) {
      onLimitsUpdate(result.dynamicLimits, result.maxEnvelope);
    }
  }, [result?.dynamicLimits, result?.maxEnvelope, onLimitsUpdate]);

  const checkCompliance = useCallback(async () => {
    if (!siteData || !metrics || massings.length === 0) {
      setResult(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Compute real site bounding-box dimensions from the drawn polygon
      let siteDimensions: { width: number; depth: number } | undefined;
      const poly = siteData.sitePolygon;
      if (poly && poly.length >= 3) {
        const lats = poly.map((p: [number, number]) => p[0]);
        const lons = poly.map((p: [number, number]) => p[1]);
        const centerLat = (Math.max(...lats) + Math.min(...lats)) / 2;
        const mPerDegLat = 111320;
        const mPerDegLon = 111320 * Math.cos(centerLat * Math.PI / 180);
        siteDimensions = {
          width: (Math.max(...lons) - Math.min(...lons)) * mPerDegLon,
          depth: (Math.max(...lats) - Math.min(...lats)) * mPerDegLat,
        };
      }

      const siteProfile = {
        location: siteData.center,
        elevation: siteData.elevation,
        siteArea: siteData.area,
        siteDimensions,
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

  const borderColor = !result ? "border-border" : result.compliant ? "border-green-400" : "border-red-400";

  return (
    <div className={`bg-white border ${borderColor} rounded-lg shadow-sm overflow-hidden transition-all`} data-testid="compliance-panel">
      <div className={`px-3 py-2 border-b ${borderColor} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${!result ? "bg-gray-300" : result.compliant ? "bg-green-500 animate-pulse" : "bg-red-500 animate-pulse"}`} />
          <h3 className="text-xs font-bold text-primary uppercase tracking-wider">NBC Compliance</h3>
        </div>
        {result && (
          <div className={`text-[10px] font-bold ${result.compliant ? "text-green-600" : "text-red-600"}`}>
            {result.score}/100
          </div>
        )}
      </div>

      <div className="p-3 space-y-3 max-h-[400px] overflow-y-auto">
        {!siteData ? (
          <div className="space-y-2 py-3">
            <div className="flex items-center gap-2 p-2 bg-primary/5 rounded border border-primary/20">
              <div className="w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">1</div>
              <div className="text-[11px] text-primary font-medium">Draw your site boundary on the map first</div>
            </div>
            <div className="flex items-center gap-2 p-2 bg-muted/40 rounded border border-border opacity-50">
              <div className="w-5 h-5 rounded-full bg-muted border border-border text-[10px] font-bold flex items-center justify-center flex-shrink-0 text-muted-foreground">2</div>
              <div className="text-[11px] text-muted-foreground">Place massing blocks on the 3D site</div>
            </div>
            <div className="flex items-center gap-2 p-2 bg-muted/40 rounded border border-border opacity-50">
              <div className="w-5 h-5 rounded-full bg-muted border border-border text-[10px] font-bold flex items-center justify-center flex-shrink-0 text-muted-foreground">3</div>
              <div className="text-[11px] text-muted-foreground">NBC compliance score appears here</div>
            </div>
          </div>
        ) : massings.length === 0 ? (
          <div className="space-y-2 py-3">
            <div className="flex items-center gap-2 p-2 bg-green-50 rounded border border-green-200">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              <div className="text-[11px] text-green-700 font-medium">Site selected: {Math.round(siteData.area).toLocaleString()} sqm</div>
            </div>
            <div className="flex items-center gap-2 p-2 bg-primary/5 rounded border border-primary/20">
              <div className="w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">2</div>
              <div className="text-[11px] text-primary font-medium">Select "Place Massing" and click on the 3D site to add building blocks</div>
            </div>
            <div className="flex items-center gap-2 p-2 bg-muted/40 rounded border border-border opacity-50">
              <div className="w-5 h-5 rounded-full bg-muted border border-border text-[10px] font-bold flex items-center justify-center flex-shrink-0 text-muted-foreground">3</div>
              <div className="text-[11px] text-muted-foreground">NBC compliance score appears here</div>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-6">
            <div className="text-center space-y-2">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <div className="text-[10px] text-primary">Analyzing NBC compliance...</div>
            </div>
          </div>
        ) : error ? (
          <div className="text-[11px] text-red-600 bg-red-50 rounded p-2 border border-red-200">
            {error}
          </div>
        ) : result ? (
          <>
            <div className={`rounded-lg p-2.5 ${result.compliant ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
              <div className={`text-xs font-semibold ${result.compliant ? "text-green-700" : "text-red-700"}`}>
                {result.compliant ? "COMPLIANT" : "NON-COMPLIANT"}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">{result.zoningSummary}</div>
            </div>

            {result.violations.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Violations</div>
                {result.violations.map((v, i) => (
                  <div key={i} className={`rounded p-2 border text-[10px] ${
                    v.severity === "critical" ? "bg-red-50 border-red-200 text-red-700" :
                    v.severity === "warning" ? "bg-amber-50 border-amber-200 text-amber-700" :
                    "bg-blue-50 border-blue-200 text-blue-700"
                  }`}>
                    <div className="font-medium">{v.code}</div>
                    <div className="text-muted-foreground mt-0.5">{v.description}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Solar Analysis</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-full h-2">
                  <div className="h-2 rounded-full transition-all" style={{
                    width: `${result.solarExposure}%`,
                    backgroundColor: result.solarExposure >= 75 ? "#16a34a" : result.solarExposure >= 50 ? "#ca8a04" : "#dc2626",
                  }} />
                </div>
                <span className={`text-[10px] font-medium ${result.solarExposure >= 75 ? "text-green-600" : "text-amber-600"}`}>
                  {result.solarExposure}%
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground">Target: 75% | {result.solarExposure >= 75 ? "Achieved" : `${75 - result.solarExposure}% below target`}</div>
            </div>

            {result.recommendations.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Recommendations</div>
                {result.recommendations.map((r, i) => (
                  <div key={i} className="text-[10px] text-primary bg-primary/5 rounded p-2 border border-primary/10">
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
