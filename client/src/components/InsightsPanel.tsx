import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { SiteAnalysis } from "@shared/schema";
import { useEffect } from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, Area, AreaChart,
} from "recharts";
import { useTheme } from "@/lib/theme";

interface InsightsPanelProps {
  location: { lat: number; lon: number; name: string } | null;
  onAnalysisReady?: () => void;
}

function CircularGauge({ score, size = 90, isDark = true }: { score: number; size?: number; isDark?: boolean }) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = score >= 75 ? "#00C853" : score >= 55 ? "#F59E0B" : "#EF4444";
  const glowColor = score >= 75 ? "rgba(0,200,83,0.3)" : score >= 55 ? "rgba(245,158,11,0.3)" : "rgba(239,68,68,0.3)";
  const trackColor = isDark ? "hsl(150 20% 14%)" : "hsl(150 12% 88%)";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <filter id="scoreGlow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth="5" />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${progress} ${circumference - progress}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 0.8s ease", filter: "url(#scoreGlow)" }}
      />
      <text x={size / 2} y={size / 2 + 1} textAnchor="middle" fill={color} fontSize="18" fontWeight="800" fontFamily="Inter">
        {score}
      </text>
      <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fill={isDark ? "#7A8A82" : "#94A3B8"} fontSize="8" fontWeight="500">
        /100
      </text>
    </svg>
  );
}

function MetricBar({ value, color, max = 100 }: { value: number; color: string; max?: number }) {
  return (
    <div className="w-full bg-muted rounded-full h-2 mt-1.5 overflow-hidden">
      <div
        className="h-2 rounded-full transition-all duration-700"
        style={{
          width: `${(value / max) * 100}%`,
          background: `linear-gradient(90deg, ${color}, ${color}CC)`,
          boxShadow: `0 0 8px ${color}40`,
        }}
      />
    </div>
  );
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      className="w-2 h-2 rounded-full shrink-0"
      style={{ background: color, boxShadow: `0 0 6px ${color}50` }}
    />
  );
}

export default function InsightsPanel({ location, onAnalysisReady }: InsightsPanelProps) {
  const { isDark } = useTheme();
  const chartAxisColor = isDark ? "#7A8A82" : "#94A3B8";
  const chartGridColor = isDark ? "#1C2A23" : "#E2E8F0";
  const tooltipStyle = {
    background: isDark ? "#111916" : "#FFFFFF",
    border: `1px solid ${isDark ? "#1C2A23" : "#E2E8F0"}`,
    borderRadius: 8,
    fontSize: 11,
    color: isDark ? "#E8EDEB" : "#1A2E1F",
    boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
  };

  const { data: analysis, isLoading } = useQuery<SiteAnalysis>({
    queryKey: ["analysis", location?.lat, location?.lon],
    queryFn: async () => {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: location!.lat, lon: location!.lon, name: location!.name }),
      });
      if (!res.ok) throw new Error("Failed to analyze");
      return res.json();
    },
    enabled: !!location,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (analysis && onAnalysisReady) onAnalysisReady();
  }, [analysis, onAnalysisReady]);

  if (!location || isLoading) {
    return (
      <div className="flex flex-col h-full w-full p-4 space-y-4">
        <Skeleton className="h-6 w-48 bg-muted" />
        <Skeleton className="h-4 w-32 bg-muted" />
        <Skeleton className="h-32 w-full rounded-xl bg-muted" />
        <Skeleton className="h-20 w-full bg-muted" />
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full bg-muted" />)}
      </div>
    );
  }

  if (!analysis) return null;

  const scoreColor = analysis.overallScore >= 75 ? "#00C853" : analysis.overallScore >= 55 ? "#F59E0B" : "#EF4444";
  const scoreLabel = analysis.overallScore >= 75 ? "Good Location" : analysis.overallScore >= 55 ? "Moderate" : "Poor";
  const scoreBg = analysis.overallScore >= 75
    ? (isDark ? "rgba(0,200,83,0.08)" : "rgba(0,200,83,0.05)")
    : analysis.overallScore >= 55
    ? (isDark ? "rgba(245,158,11,0.08)" : "rgba(245,158,11,0.05)")
    : (isDark ? "rgba(239,68,68,0.08)" : "rgba(239,68,68,0.05)");

  const radarData = analysis.radarData ? [
    { axis: "Solar", value: analysis.radarData.solar },
    { axis: "Soil", value: analysis.radarData.soil },
    { axis: "Wind", value: analysis.radarData.wind },
    { axis: "Water", value: analysis.radarData.water },
    { axis: "Access", value: analysis.radarData.access },
  ] : [];

  return (
    <div className="flex flex-col h-full w-full">
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">

          <div>
            <h2 className="font-semibold text-base text-foreground flex items-center gap-2" data-testid="text-insights-title">
              <span className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: "linear-gradient(135deg, #00C853, #00E676)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M2 12c2-3 6-5 10-5s8 2 10 5c-2 3-6 5-10 5s-8-2-10-5z"/><circle cx="12" cy="12" r="3"/></svg>
              </span>
              AI Site Analysis
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5 ml-8">Real GIS data + AI intelligence</p>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-foreground mb-3">Overall Site Suitability</h3>
            <div
              className="border rounded-xl p-4"
              style={{ background: scoreBg, borderColor: `${scoreColor}30` }}
              data-testid="card-overall-score"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold" style={{ color: scoreColor }} data-testid="text-score-value">
                      {analysis.overallScore}
                    </span>
                    <span className="text-lg text-muted-foreground font-light">/100</span>
                  </div>
                  <p className="text-sm font-semibold mt-1" style={{ color: scoreColor }}>{scoreLabel}</p>
                </div>
                <CircularGauge score={analysis.overallScore} isDark={isDark} />
              </div>
              {analysis.aiNarrative ? (
                <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed" data-testid="text-ai-narrative">
                  {analysis.aiNarrative}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                  Based on environmental metrics, zoning, and site conditions
                </p>
              )}
            </div>
          </div>

          {analysis.developmentDensity && (
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3">Development Density</h3>
              <div className="bg-muted/40 border border-border rounded-xl p-4" data-testid="card-development-density">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #7C3AED, #A855F7)" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01" /><path d="M16 6h.01" /><path d="M12 6h.01" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground" data-testid="text-density-label">{analysis.developmentDensity.densityLabel}</p>
                      <p className="text-[10px] text-muted-foreground">Urban Development Index</p>
                    </div>
                  </div>
                  <span className="text-2xl font-extrabold" style={{ color: "#7C3AED" }} data-testid="text-density-index">{analysis.developmentDensity.densityIndex}%</span>
                </div>
                <MetricBar value={analysis.developmentDensity.densityIndex} color="#7C3AED" />
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="flex items-center gap-1.5 text-xs">
                    <ColorDot color="#06B6D4" />
                    <span className="text-muted-foreground">Building:</span>
                    <span className="text-foreground font-semibold ml-auto">{analysis.developmentDensity.buildingFootprint}%</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <ColorDot color="#F59E0B" />
                    <span className="text-muted-foreground">Infra:</span>
                    <span className="text-foreground font-semibold ml-auto">{analysis.developmentDensity.infrastructureCoverage}%</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {analysis.siteInfo && (
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3">Site Information</h3>
              <div className="bg-muted/30 border border-border rounded-xl p-3.5 space-y-2.5" data-testid="card-site-info">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <ColorDot color="#3B82F6" />
                    Coordinates
                  </span>
                  <span className="text-foreground font-mono text-[11px]" data-testid="text-coordinates">
                    {analysis.siteInfo.coordinates.lat.toFixed(4)}, {analysis.siteInfo.coordinates.lon.toFixed(4)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <ColorDot color="#059669" />
                    Elevation
                  </span>
                  <span className="text-foreground font-semibold" data-testid="text-elevation">{analysis.siteInfo.elevation} {analysis.siteInfo.elevationUnit}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <ColorDot color="#8B5CF6" />
                    Zoning
                  </span>
                  <span className="font-semibold" style={{ color: "#8B5CF6" }} data-testid="text-zoning">{analysis.siteInfo.zoning}</span>
                </div>
              </div>
            </div>
          )}

          {analysis.environmentalMetrics && (
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3">Environmental Metrics</h3>
              <div className="grid grid-cols-2 gap-2" data-testid="grid-environmental-metrics">
                <div className="border rounded-lg p-3" style={{ background: isDark ? "rgba(245,158,11,0.06)" : "rgba(245,158,11,0.04)", borderColor: "rgba(245,158,11,0.2)" }} data-testid="card-sun-exposure">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "linear-gradient(135deg, #F59E0B, #FBBF24)" }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-medium">Sun Exposure</span>
                  </div>
                  <p className="text-xl font-extrabold" style={{ color: "#F59E0B" }} data-testid="text-sun-exposure">{analysis.environmentalMetrics.sunExposure}%</p>
                  <MetricBar value={analysis.environmentalMetrics.sunExposure} color="#F59E0B" />
                </div>
                <div className="border rounded-lg p-3" style={{ background: isDark ? "rgba(34,197,94,0.06)" : "rgba(34,197,94,0.04)", borderColor: "rgba(34,197,94,0.2)" }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "linear-gradient(135deg, #22C55E, #4ADE80)" }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-medium">Soil Quality</span>
                  </div>
                  <p className="text-xl font-extrabold" style={{ color: "#22C55E" }}>{analysis.environmentalMetrics.soilQuality}%</p>
                  <MetricBar value={analysis.environmentalMetrics.soilQuality} color="#22C55E" />
                </div>
                <div className="border rounded-lg p-3" style={{ background: isDark ? "rgba(59,130,246,0.06)" : "rgba(59,130,246,0.04)", borderColor: "rgba(59,130,246,0.2)" }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "linear-gradient(135deg, #3B82F6, #60A5FA)" }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-medium">Wind Exposure</span>
                  </div>
                  <p className="text-xl font-extrabold" style={{ color: "#3B82F6" }}>{analysis.environmentalMetrics.windExposure}%</p>
                  <MetricBar value={analysis.environmentalMetrics.windExposure} color="#3B82F6" />
                </div>
                <div className="border rounded-lg p-3" style={{
                  background: isDark
                    ? (analysis.environmentalMetrics.floodRisk === "High" ? "rgba(239,68,68,0.08)" : analysis.environmentalMetrics.floodRisk === "Moderate" ? "rgba(245,158,11,0.06)" : "rgba(34,197,94,0.06)")
                    : (analysis.environmentalMetrics.floodRisk === "High" ? "rgba(239,68,68,0.05)" : analysis.environmentalMetrics.floodRisk === "Moderate" ? "rgba(245,158,11,0.04)" : "rgba(34,197,94,0.04)"),
                  borderColor: analysis.environmentalMetrics.floodRisk === "High" ? "rgba(239,68,68,0.25)" : analysis.environmentalMetrics.floodRisk === "Moderate" ? "rgba(245,158,11,0.2)" : "rgba(34,197,94,0.2)",
                }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-5 h-5 rounded flex items-center justify-center" style={{
                      background: analysis.environmentalMetrics.floodRisk === "High"
                        ? "linear-gradient(135deg, #EF4444, #F87171)"
                        : analysis.environmentalMetrics.floodRisk === "Moderate"
                        ? "linear-gradient(135deg, #F59E0B, #FBBF24)"
                        : "linear-gradient(135deg, #22C55E, #4ADE80)",
                    }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-medium">Flood Risk</span>
                  </div>
                  <p className={`text-lg font-extrabold ${
                    analysis.environmentalMetrics.floodRisk === "High" ? "text-red-500" :
                    analysis.environmentalMetrics.floodRisk === "Moderate" ? "text-amber-500" : "text-green-500"
                  }`}>
                    {analysis.environmentalMetrics.floodRisk}
                  </p>
                </div>
              </div>
            </div>
          )}

          {analysis.sunPathData && (
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
                <span className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "linear-gradient(135deg, #F59E0B, #EF4444)" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42"/></svg>
                </span>
                Sun Path Data
                <span className="text-[9px] text-muted-foreground font-normal ml-auto">(Local Time)</span>
              </h3>
              <div className="border rounded-xl p-4" style={{ background: isDark ? "rgba(245,158,11,0.05)" : "rgba(245,158,11,0.03)", borderColor: "rgba(245,158,11,0.15)" }} data-testid="card-sun-path">
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <div className="w-8 h-8 mx-auto mb-1.5 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #FBBF24, #F59E0B)" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 2v2"/><circle cx="12" cy="12" r="4"/><path d="M4.93 4.93l1.41 1.41"/><path d="M2 12h2"/><path d="M4.93 19.07l1.41-1.41"/></svg>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Sunrise</p>
                    <p className="text-sm font-bold" style={{ color: "#F59E0B" }}>{analysis.sunPathData.sunrise}</p>
                  </div>
                  <div className="text-center">
                    <div className="w-8 h-8 mx-auto mb-1.5 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #06B6D4, #0EA5E9)" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Solar Noon</p>
                    <p className="text-sm font-bold text-foreground">{analysis.sunPathData.solarNoon}</p>
                  </div>
                  <div className="text-center">
                    <div className="w-8 h-8 mx-auto mb-1.5 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #F97316, #EF4444)" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 22v-2"/><circle cx="12" cy="12" r="4"/><path d="M19.07 19.07l-1.41-1.41"/><path d="M22 12h-2"/><path d="M19.07 4.93l-1.41 1.41"/></svg>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Sunset</p>
                    <p className="text-sm font-bold" style={{ color: "#F97316" }}>{analysis.sunPathData.sunset}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3 pt-3" style={{ borderTop: `1px solid ${isDark ? "rgba(245,158,11,0.1)" : "rgba(245,158,11,0.15)"}` }}>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Day Length</p>
                    <p className="text-sm font-bold text-foreground">{analysis.sunPathData.dayLength}h</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Max Altitude</p>
                    <p className="text-sm font-bold" style={{ color: "#FBBF24" }}>{analysis.sunPathData.maxAltitude}°</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Azimuth</p>
                    <p className="text-sm font-bold text-foreground">{analysis.sunPathData.azimuthRange.min}°–{analysis.sunPathData.azimuthRange.max}°</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {analysis.elevationProfile && analysis.elevationProfile.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
                <span className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "linear-gradient(135deg, #059669, #10B981)" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>
                </span>
                Elevation Profile
              </h3>
              <div className="bg-muted/40 border border-border rounded-xl p-3 h-[150px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analysis.elevationProfile} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                    <defs>
                      <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="distance"
                      tickFormatter={(v) => `${v}m`}
                      tick={{ fontSize: 9, fill: chartAxisColor }}
                      axisLine={{ stroke: chartGridColor }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: chartAxisColor }}
                      axisLine={{ stroke: chartGridColor }}
                      tickLine={false}
                      width={35}
                      tickFormatter={(v) => `${v}m`}
                    />
                    <RechartsTooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number) => [`${value}m`, "Elevation"]}
                      labelFormatter={(label) => `Distance: ${label}m`}
                    />
                    <Area type="monotone" dataKey="elevation" stroke="#10B981" strokeWidth={2.5} fill="url(#elevGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {radarData.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
                <span className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "linear-gradient(135deg, #3B82F6, #6366F1)" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polygon points="12 2 22 8.5 18 20 6 20 2 8.5"/></svg>
                </span>
                Site Suitability Radar
              </h3>
              <div className="bg-muted/40 border border-border rounded-xl p-3 h-[210px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                    <PolarGrid stroke={chartGridColor} />
                    <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10, fill: chartAxisColor, fontWeight: 600 }} />
                    <PolarRadiusAxis
                      angle={90}
                      domain={[0, 100]}
                      tick={{ fontSize: 8, fill: chartAxisColor }}
                      axisLine={false}
                    />
                    <Radar
                      dataKey="value"
                      stroke="#6366F1"
                      fill="#6366F1"
                      fillOpacity={0.25}
                      strokeWidth={2.5}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {analysis.recommendations && analysis.recommendations.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
                <span className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "linear-gradient(135deg, #8B5CF6, #A855F7)" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                </span>
                AI Recommendations
              </h3>
              <div className="space-y-2">
                {analysis.recommendations.map((rec, i) => {
                  const colors = {
                    success: { bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.25)", icon: "#22C55E", gradient: "linear-gradient(135deg, #22C55E, #4ADE80)" },
                    warning: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", icon: "#F59E0B", gradient: "linear-gradient(135deg, #F59E0B, #FBBF24)" },
                    info: { bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.25)", icon: "#3B82F6", gradient: "linear-gradient(135deg, #3B82F6, #60A5FA)" },
                  };
                  const c = colors[rec.type] || colors.info;

                  return (
                    <div key={i} className="border rounded-lg p-3" style={{ background: c.bg, borderColor: c.border }} data-testid={`recommendation-${i}`}>
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 shrink-0 w-5 h-5 rounded flex items-center justify-center" style={{ background: c.gradient }}>
                          {rec.type === "success" && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>}
                          {rec.type === "warning" && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M12 9v4M12 17h.01"/></svg>}
                          {rec.type === "info" && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>}
                        </div>
                        <div>
                          <p className="text-xs font-bold" style={{ color: c.icon }}>{rec.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{rec.description}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground/60 italic pb-4 flex items-center gap-1.5">
            <ColorDot color="#00C853" />
            Data sourced from FEMA NFHL, USGS, USDA, OpenStreetMap, Open-Meteo
          </div>

        </div>
      </ScrollArea>
    </div>
  );
}
