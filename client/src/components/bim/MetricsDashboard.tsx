import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";
import type { BimMetrics } from "./BimViewport";
import type { SiteData } from "./SiteSelector";

interface MetricsDashboardProps {
  metrics: BimMetrics | null;
  siteData: SiteData | null;
  complianceScore: number;
  dynamicLimits?: {
    far: number;
    groundCoverage: number;
    openSpace: number;
    maxHeight: number;
  };
}

const DEFAULT_LIMITS = { far: 2.5, groundCoverage: 50, openSpace: 30, maxHeight: 45 };

export default function MetricsDashboard({ metrics, siteData, complianceScore, dynamicLimits }: MetricsDashboardProps) {
  if (!metrics || !siteData) {
    return (
      <div className="bg-white border border-border rounded-lg p-4 text-center text-muted-foreground text-[11px] shadow-sm" data-testid="metrics-dashboard">
        Metrics will appear after placing massing boxes
      </div>
    );
  }

  const limits = { ...DEFAULT_LIMITS, ...(dynamicLimits || {}) };

  const transitScore = Math.min(100, (siteData.amenities.transit / 5) * 100);
  const greenScore = Math.min(100, metrics.openSpace);
  const solarScore = Math.min(100, Math.max(0, 100 - (metrics.groundCoverage > 60 ? (metrics.groundCoverage - 60) * 2 : 0)));
  const structuralScore = metrics.maxHeight > 100 ? Math.max(30, 100 - (metrics.maxHeight - 100)) : 100;
  const densityScore = metrics.far > 0 ? Math.min(100, (metrics.far / Math.max(0.1, limits.far + 1)) * 100) : 0;

  const radarData = [
    { axis: "Solar", value: Math.round(solarScore), fullMark: 100 },
    { axis: "Structure", value: Math.round(structuralScore), fullMark: 100 },
    { axis: "NBC", value: Math.round(complianceScore), fullMark: 100 },
    { axis: "Transit", value: Math.round(transitScore), fullMark: 100 },
    { axis: "Green", value: Math.round(greenScore), fullMark: 100 },
    { axis: "Density", value: Math.round(densityScore), fullMark: 100 },
  ];

  const farAllowed = limits.far;
  const maxHeightAllowed = limits.maxHeight;
  const coverageAllowed = limits.groundCoverage;
  const openSpaceMin = limits.openSpace;

  return (
    <div className="space-y-3" data-testid="metrics-dashboard">
      <div className="bg-white border border-border rounded-lg overflow-hidden shadow-sm">
        <div className="px-3 py-2 border-b border-border">
          <h3 className="text-xs font-bold text-primary uppercase tracking-wider">Suitability Radar</h3>
        </div>
        <div className="p-2" data-testid="radar-chart">
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={radarData} margin={{ top: 5, right: 25, bottom: 5, left: 25 }}>
              <PolarGrid stroke="#E2E8F0" />
              <PolarAngleAxis dataKey="axis" tick={{ fill: "#64748B", fontSize: 10 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name="Score" dataKey="value" stroke="#2C5282" fill="#2C5282" fillOpacity={0.12} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white border border-border rounded-lg overflow-hidden shadow-sm">
        <div className="px-3 py-2 border-b border-border">
          <h3 className="text-xs font-bold text-primary uppercase tracking-wider">Key Metrics</h3>
        </div>
        <div className="p-2 grid grid-cols-2 gap-1.5">
          <MetricCard label="FAR" value={metrics.far.toFixed(2)} limit={`/ ${farAllowed}`} warn={metrics.far > farAllowed} />
          <MetricCard label="Ground Coverage" value={`${metrics.groundCoverage}%`} limit={`/ ${coverageAllowed}%`} warn={metrics.groundCoverage > coverageAllowed} />
          <MetricCard label="Open Space" value={`${metrics.openSpace}%`} limit={`/ ${openSpaceMin}%`} warn={metrics.openSpace < openSpaceMin} />
          <MetricCard label="Max Height" value={`${metrics.maxHeight}m`} limit={`/ ${maxHeightAllowed}m`} warn={metrics.maxHeight > maxHeightAllowed} />
          <MetricCard label="Total Built-Up" value={`${(metrics.totalBuiltUp / 1000).toFixed(1)}K`} unit="sqm" />
          <MetricCard label="Est. Units" value={`${metrics.estimatedUnits}`} />
          <MetricCard label="Massings" value={`${metrics.massingCount}`} />
          <MetricCard label="Avg Height" value={`${metrics.avgHeight}m`} />
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, limit, unit, warn }: { label: string; value: string; limit?: string; unit?: string; warn?: boolean }) {
  return (
    <div className={`rounded p-2 border ${warn ? "bg-red-50 border-red-200" : "bg-muted/40 border-border"}`}>
      <div className={`text-sm font-bold ${warn ? "text-red-600" : "text-primary"}`}>
        {value}{limit && <span className="text-[10px] text-muted-foreground ml-0.5">{limit}</span>}
        {unit && <span className="text-[10px] text-muted-foreground ml-0.5">{unit}</span>}
      </div>
      <div className="text-[9px] text-muted-foreground">{label}</div>
    </div>
  );
}
