import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { SiteAnalysis } from "@shared/schema";
import { useEffect } from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, Area, AreaChart,
} from "recharts";

interface InsightsPanelProps {
  location: { lat: number; lon: number; name: string } | null;
  onAnalysisReady?: () => void;
}

function CircularGauge({ score, size = 80 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = score >= 75 ? "#00C853" : score >= 55 ? "#F59E0B" : "#EF4444";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(150 20% 14%)" strokeWidth="4" />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={`${progress} ${circumference - progress}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
      <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fill={color} fontSize="10" fontWeight="600">
        <tspan>{score}</tspan>
      </text>
    </svg>
  );
}

function MetricBar({ value, color, max = 100 }: { value: number; color: string; max?: number }) {
  return (
    <div className="w-full bg-muted rounded-full h-1.5 mt-1">
      <div
        className="h-1.5 rounded-full transition-all duration-700"
        style={{ width: `${(value / max) * 100}%`, backgroundColor: color }}
      />
    </div>
  );
}

export default function InsightsPanel({ location, onAnalysisReady }: InsightsPanelProps) {
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
            <h2 className="font-semibold text-base text-foreground" data-testid="text-insights-title">AI Site Analysis</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Real-time intelligence & recommendations</p>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-foreground mb-3">Overall Site Suitability</h3>
            <div className="bg-muted/40 border border-border rounded-xl p-4" data-testid="card-overall-score">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold" style={{ color: scoreColor }} data-testid="text-score-value">
                      {analysis.overallScore}
                    </span>
                    <span className="text-lg text-muted-foreground">/100</span>
                  </div>
                  <p className="text-sm font-medium mt-1" style={{ color: scoreColor }}>{scoreLabel}</p>
                </div>
                <CircularGauge score={analysis.overallScore} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                Based on environmental metrics, zoning, and site conditions
              </p>
            </div>
          </div>

          {analysis.developmentDensity && (
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3">Development Density Analysis</h3>
              <div className="bg-muted/40 border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                        <rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01" /><path d="M16 6h.01" /><path d="M12 6h.01" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{analysis.developmentDensity.densityLabel}</p>
                      <p className="text-[10px] text-muted-foreground">Urban Development Index</p>
                    </div>
                  </div>
                  <span className="text-2xl font-bold text-primary">{analysis.developmentDensity.densityIndex}%</span>
                </div>
                <MetricBar value={analysis.developmentDensity.densityIndex} color="#00C853" />
                <div className="flex justify-between mt-3 text-xs text-muted-foreground">
                  <span>Building Footprint:</span>
                  <span className="text-foreground font-medium">{analysis.developmentDensity.buildingFootprint}%</span>
                </div>
                <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                  <span>Infrastructure Coverage:</span>
                  <span className="text-foreground font-medium">{analysis.developmentDensity.infrastructureCoverage}%</span>
                </div>
              </div>
            </div>
          )}

          {analysis.siteInfo && (
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3">Site Information</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                    Coordinates
                  </span>
                  <span className="text-foreground font-mono text-[11px]">
                    {analysis.siteInfo.coordinates.lat.toFixed(6)}<br/>{analysis.siteInfo.coordinates.lon.toFixed(6)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                    Elevation
                  </span>
                  <span className="text-foreground font-medium">{analysis.siteInfo.elevation} {analysis.siteInfo.elevationUnit}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                    Zoning
                  </span>
                  <span className="text-primary font-medium">{analysis.siteInfo.zoning}</span>
                </div>
              </div>
            </div>
          )}

          {analysis.environmentalMetrics && (
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3">Environmental Metrics</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-muted/40 border border-border rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                    <span className="text-[10px] text-muted-foreground">Sun Exposure</span>
                  </div>
                  <p className="text-xl font-bold text-foreground">{analysis.environmentalMetrics.sunExposure}%</p>
                  <MetricBar value={analysis.environmentalMetrics.sunExposure} color="#F59E0B" />
                </div>
                <div className="bg-muted/40 border border-border rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>
                    <span className="text-[10px] text-muted-foreground">Soil Quality</span>
                  </div>
                  <p className="text-xl font-bold text-foreground">{analysis.environmentalMetrics.soilQuality}%</p>
                  <MetricBar value={analysis.environmentalMetrics.soilQuality} color="#22C55E" />
                </div>
                <div className="bg-muted/40 border border-border rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>
                    <span className="text-[10px] text-muted-foreground">Wind Exposure</span>
                  </div>
                  <p className="text-xl font-bold text-foreground">{analysis.environmentalMetrics.windExposure}%</p>
                  <MetricBar value={analysis.environmentalMetrics.windExposure} color="#3B82F6" />
                </div>
                <div className="bg-muted/40 border border-border rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2"><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>
                    <span className="text-[10px] text-muted-foreground">Flood Risk</span>
                  </div>
                  <p className={`text-lg font-bold ${
                    analysis.environmentalMetrics.floodRisk === "High" ? "text-red-500" :
                    analysis.environmentalMetrics.floodRisk === "Moderate" ? "text-amber-500" : "text-green-500"
                  }`}>
                    {analysis.environmentalMetrics.floodRisk}
                  </p>
                </div>
              </div>
            </div>
          )}

          {analysis.elevationProfile && analysis.elevationProfile.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3">Elevation Profile</h3>
              <div className="bg-muted/40 border border-border rounded-xl p-3 h-[140px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analysis.elevationProfile} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                    <defs>
                      <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00C853" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#00C853" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="distance"
                      tickFormatter={(v) => `${v}m`}
                      tick={{ fontSize: 9, fill: "#7A8A82" }}
                      axisLine={{ stroke: "#1C2A23" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: "#7A8A82" }}
                      axisLine={{ stroke: "#1C2A23" }}
                      tickLine={false}
                      width={35}
                      tickFormatter={(v) => `${v}m`}
                    />
                    <RechartsTooltip
                      contentStyle={{ background: "#111916", border: "1px solid #1C2A23", borderRadius: 8, fontSize: 11, color: "#E8EDEB" }}
                      formatter={(value: number) => [`${value}m`, "Elevation"]}
                      labelFormatter={(label) => `Distance: ${label}m`}
                    />
                    <Area type="monotone" dataKey="elevation" stroke="#00C853" strokeWidth={2} fill="url(#elevGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {radarData.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3">Site Suitability Analysis</h3>
              <div className="bg-muted/40 border border-border rounded-xl p-3 h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                    <PolarGrid stroke="#1C2A23" />
                    <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10, fill: "#7A8A82" }} />
                    <PolarRadiusAxis
                      angle={90}
                      domain={[0, 100]}
                      tick={{ fontSize: 8, fill: "#7A8A82" }}
                      axisLine={false}
                    />
                    <Radar
                      dataKey="value"
                      stroke="#00C853"
                      fill="#00C853"
                      fillOpacity={0.2}
                      strokeWidth={2}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {analysis.recommendations && analysis.recommendations.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary"><path d="M2 12c2-3 6-5 10-5s8 2 10 5c-2 3-6 5-10 5s-8-2-10-5z"/><circle cx="12" cy="12" r="3"/></svg>
                AI Recommendations
              </h3>
              <div className="space-y-2">
                {analysis.recommendations.map((rec, i) => {
                  const borderColor = rec.type === "success" ? "border-green-500/30" : rec.type === "warning" ? "border-amber-500/30" : "border-blue-500/30";
                  const bgColor = rec.type === "success" ? "bg-green-500/5" : rec.type === "warning" ? "bg-amber-500/5" : "bg-blue-500/5";
                  const iconColor = rec.type === "success" ? "#22C55E" : rec.type === "warning" ? "#F59E0B" : "#3B82F6";
                  const icon = rec.type === "success" ? "check" : rec.type === "warning" ? "alert" : "info";

                  return (
                    <div key={i} className={`${bgColor} border ${borderColor} rounded-lg p-3`} data-testid={`recommendation-${i}`}>
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 shrink-0">
                          {icon === "check" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>}
                          {icon === "alert" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>}
                          {icon === "info" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>}
                        </div>
                        <div>
                          <p className="text-xs font-semibold" style={{ color: iconColor }}>{rec.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{rec.description}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground/60 italic pb-4">
            * Data sourced from FEMA NFHL, USGS, USDA, and OpenStreetMap
          </div>

        </div>
      </ScrollArea>
    </div>
  );
}
