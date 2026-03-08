import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";
import type { BimMetrics } from "./BimViewport";
import type { SiteData } from "./SiteSelector";

interface MetricsDashboardProps {
  metrics: BimMetrics | null;
  siteData: SiteData | null;
  complianceScore: number;
}

const COST_PER_SQFT: Record<string, number> = {
  residential: 2200,
  commercial: 2800,
  office: 3200,
  mixed_use: 2600,
  hotel: 3500,
  industrial: 1800,
};

export default function MetricsDashboard({ metrics, siteData, complianceScore }: MetricsDashboardProps) {
  if (!metrics || !siteData) {
    return (
      <div className="bg-black/80 border border-gray-800 rounded-lg p-4 text-center text-gray-600 text-[11px]" data-testid="metrics-dashboard">
        Metrics will appear after placing massing boxes
      </div>
    );
  }

  const transitScore = Math.min(100, (siteData.amenities.transit / 5) * 100);
  const greenScore = Math.min(100, metrics.openSpace);
  const solarScore = Math.min(100, Math.max(0, 100 - (metrics.groundCoverage > 60 ? (metrics.groundCoverage - 60) * 2 : 0)));
  const structuralScore = metrics.maxHeight > 100 ? Math.max(30, 100 - (metrics.maxHeight - 100)) : 100;
  const densityScore = metrics.far > 0 ? Math.min(100, (metrics.far / 4) * 100) : 0;

  const radarData = [
    { axis: "Solar", value: Math.round(solarScore), fullMark: 100 },
    { axis: "Structure", value: Math.round(structuralScore), fullMark: 100 },
    { axis: "NBC", value: Math.round(complianceScore), fullMark: 100 },
    { axis: "Transit", value: Math.round(transitScore), fullMark: 100 },
    { axis: "Green", value: Math.round(greenScore), fullMark: 100 },
    { axis: "Density", value: Math.round(densityScore), fullMark: 100 },
  ];

  const estCostPerSqft = 2500;
  const estCost = metrics.totalBuiltUp * estCostPerSqft * 0.0929;
  const estRevenue = estCost * 1.35;
  const roi = estCost > 0 ? ((estRevenue - estCost) / estCost * 100) : 0;

  const farAllowed = 2.5;
  const maxHeightAllowed = 45;
  const coverageAllowed = 50;

  return (
    <div className="space-y-3" data-testid="metrics-dashboard">
      <div className="bg-black/80 border border-cyan-900/30 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-cyan-900/30">
          <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Suitability Radar</h3>
        </div>
        <div className="p-2" data-testid="radar-chart">
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={radarData} margin={{ top: 5, right: 25, bottom: 5, left: 25 }}>
              <PolarGrid stroke="#1a2a3a" />
              <PolarAngleAxis dataKey="axis" tick={{ fill: "#6b7280", fontSize: 10 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name="Score" dataKey="value" stroke="#00bcd4" fill="#00bcd4" fillOpacity={0.15} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-black/80 border border-cyan-900/30 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-cyan-900/30">
          <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Key Metrics</h3>
        </div>
        <div className="p-2 grid grid-cols-2 gap-1.5">
          <MetricCard label="FAR" value={metrics.far.toFixed(2)} limit={`/ ${farAllowed}`} warn={metrics.far > farAllowed} />
          <MetricCard label="Ground Coverage" value={`${metrics.groundCoverage}%`} limit={`/ ${coverageAllowed}%`} warn={metrics.groundCoverage > coverageAllowed} />
          <MetricCard label="Open Space" value={`${metrics.openSpace}%`} limit="/ 30%" warn={metrics.openSpace < 30} />
          <MetricCard label="Max Height" value={`${metrics.maxHeight}m`} limit={`/ ${maxHeightAllowed}m`} warn={metrics.maxHeight > maxHeightAllowed} />
          <MetricCard label="Total Built-Up" value={`${(metrics.totalBuiltUp / 1000).toFixed(1)}K`} unit="sqm" />
          <MetricCard label="Est. Units" value={`${metrics.estimatedUnits}`} />
          <MetricCard label="Massings" value={`${metrics.massingCount}`} />
          <MetricCard label="Avg Height" value={`${metrics.avgHeight}m`} />
        </div>
      </div>

      <div className="bg-black/80 border border-cyan-900/30 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-cyan-900/30">
          <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Investment Estimate</h3>
        </div>
        <div className="p-2 space-y-1.5">
          <InvestRow label="Construction Cost" value={`₹${(estCost / 10000000).toFixed(1)} Cr`} color="text-orange-400" />
          <InvestRow label="Est. Revenue" value={`₹${(estRevenue / 10000000).toFixed(1)} Cr`} color="text-green-400" />
          <InvestRow label="Est. ROI" value={`${roi.toFixed(1)}%`} color={roi > 20 ? "text-green-400" : "text-yellow-400"} />
          <InvestRow label="Cost/sqm (built-up)" value={`₹${Math.round(estCostPerSqft * 10.764).toLocaleString()}`} color="text-gray-300" />
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, limit, unit, warn }: { label: string; value: string; limit?: string; unit?: string; warn?: boolean }) {
  return (
    <div className={`rounded p-2 border ${warn ? "bg-red-500/5 border-red-500/20" : "bg-gray-800/40 border-gray-800"}`}>
      <div className={`text-sm font-bold ${warn ? "text-red-400" : "text-cyan-400"}`}>
        {value}{limit && <span className="text-[10px] text-gray-500 ml-0.5">{limit}</span>}
        {unit && <span className="text-[10px] text-gray-500 ml-0.5">{unit}</span>}
      </div>
      <div className="text-[9px] text-gray-500">{label}</div>
    </div>
  );
}

function InvestRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${color}`}>{value}</span>
    </div>
  );
}
