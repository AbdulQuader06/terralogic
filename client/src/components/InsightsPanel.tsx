import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { SiteAnalysis } from "@shared/schema";
import {
  Building2,
  Droplets,
  Trees,
  GraduationCap,
  ThermometerSun,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Info,
  Zap,
  Mountain,
  Bus,
} from "lucide-react";

interface InsightsPanelProps {
  location: { lat: number; lon: number; name: string } | null;
}

const factorIcons: Record<string, any> = {
  "Flood Risk": Droplets,
  "Soil Stability": Trees,
  "Urban Density": Building2,
  "School Proximity": GraduationCap,
  "Climate Stress": ThermometerSun,
  "Infrastructure Access": Zap,
  "Elevation Suitability": Mountain,
};

const factorColors: Record<string, string> = {
  "Flood Risk": "text-destructive",
  "Soil Stability": "text-accent",
  "Urban Density": "text-[hsl(204,70%,53%)]",
  "School Proximity": "text-primary",
  "Climate Stress": "text-orange-500",
  "Infrastructure Access": "text-violet-500",
  "Elevation Suitability": "text-emerald-600",
};

export default function InsightsPanel({ location }: InsightsPanelProps) {
  const { data: analysis, isLoading, error } = useQuery<SiteAnalysis>({
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

  if (!location) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground p-8 text-center">
        <MapPin className="w-12 h-12 mb-4 opacity-20" />
        <h3 className="font-medium text-lg mb-2 text-foreground" data-testid="text-no-location">No Location Selected</h3>
        <p className="text-sm">Click anywhere on the map or use the search bar to analyze a specific site.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full w-full bg-background p-4 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-20 w-full" />
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  return (
    <div className="flex flex-col h-full w-full bg-background">
      <div className="p-4 border-b border-border">
        <h2 className="font-semibold text-lg flex items-center gap-2" data-testid="text-insights-title">
          Site Analysis
        </h2>
        <p className="text-sm text-muted-foreground mt-1 truncate" data-testid="text-insights-location">{location.name}</p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">

          <div className="bg-card border border-border rounded-xl p-5 text-center shadow-sm relative overflow-hidden" data-testid="card-overall-score">
            <div className={`absolute top-0 left-0 w-full h-1 ${analysis.overallScore >= 75 ? 'bg-accent' : analysis.overallScore >= 55 ? 'bg-yellow-500' : 'bg-destructive'}`}></div>
            <h3 className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">Overall Suitability</h3>
            <div className="flex items-end justify-center gap-1">
              <span className={`text-5xl font-bold tracking-tighter ${analysis.overallScore >= 75 ? 'text-accent' : analysis.overallScore >= 55 ? 'text-yellow-600' : 'text-destructive'}`} data-testid="text-score-value">
                {analysis.overallScore}
              </span>
              <span className="text-muted-foreground mb-1">/100</span>
            </div>
            <div className="mt-3 flex justify-center">
              <Badge
                variant={analysis.overallScore >= 75 ? "default" : analysis.overallScore >= 55 ? "secondary" : "destructive"}
                className="px-3 py-1"
                data-testid="badge-rating"
              >
                {analysis.rating}
              </Badge>
            </div>
          </div>

          {analysis.alerts.map((alert, i) => (
            <div
              key={i}
              className={`rounded-lg p-3 flex items-start gap-3 ${
                alert.type === "warning"
                  ? "bg-destructive/10 border border-destructive/20"
                  : alert.type === "success"
                  ? "bg-accent/10 border border-accent/20"
                  : "bg-[hsl(204,70%,53%)]/10 border border-[hsl(204,70%,53%)]/20"
              }`}
              data-testid={`alert-${alert.type}-${i}`}
            >
              {alert.type === "warning" ? (
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              ) : alert.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              ) : (
                <Info className="w-4 h-4 text-[hsl(204,70%,53%)] shrink-0 mt-0.5" />
              )}
              <div>
                <h4 className={`font-medium text-sm ${
                  alert.type === "warning" ? "text-destructive" : alert.type === "success" ? "text-accent" : "text-[hsl(204,70%,53%)]"
                }`}>{alert.title}</h4>
                <p className="text-xs text-muted-foreground mt-1">{alert.description}</p>
              </div>
            </div>
          ))}

          <div>
            <h3 className="font-medium mb-3 flex items-center gap-2 text-sm">
              Spatial Factors
            </h3>
            <div className="space-y-3">
              {analysis.factors.map((factor, i) => {
                const Icon = factorIcons[factor.name] || Info;
                const color = factorColors[factor.name] || "text-muted-foreground";
                const isRisk = factor.category === "risk";
                const barColor = isRisk
                  ? (factor.value > 50 ? "bg-destructive" : factor.value > 30 ? "bg-yellow-500" : "bg-accent")
                  : (factor.value < 40 ? "bg-destructive" : factor.value < 60 ? "bg-yellow-500" : "bg-accent");

                return (
                  <div key={i} className="space-y-1.5" data-testid={`factor-${factor.name.toLowerCase().replace(/\s/g, '-')}`}>
                    <div className="flex justify-between items-center text-sm">
                      <span className="flex items-center gap-2 font-medium">
                        <Icon className={`w-4 h-4 ${color}`} />
                        {factor.name}
                        {isRisk && <span className="text-[10px] text-destructive/70 uppercase font-semibold">risk</span>}
                      </span>
                      <span className="text-muted-foreground font-mono text-xs">{factor.value}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${factor.value}%` }}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-muted rounded-lg p-4" data-testid="card-amenities">
            <h3 className="font-medium text-sm mb-3">Local Amenities (3km radius)</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-background rounded-lg border border-border p-3 text-center">
                <GraduationCap className="w-4 h-4 mx-auto mb-1 text-primary" />
                <p className="text-xl font-bold" data-testid="text-schools-count">{analysis.amenities.schools}</p>
                <p className="text-[11px] text-muted-foreground">Schools</p>
              </div>
              <div className="bg-background rounded-lg border border-border p-3 text-center">
                <Bus className="w-4 h-4 mx-auto mb-1 text-[hsl(204,70%,53%)]" />
                <p className="text-xl font-bold" data-testid="text-transit-count">{analysis.amenities.transitStops}</p>
                <p className="text-[11px] text-muted-foreground">Transit Stops</p>
              </div>
              <div className="bg-background rounded-lg border border-border p-3 text-center">
                <Building2 className="w-4 h-4 mx-auto mb-1 text-destructive" />
                <p className="text-xl font-bold" data-testid="text-hospitals-count">{analysis.amenities.hospitals}</p>
                <p className="text-[11px] text-muted-foreground">Hospitals</p>
              </div>
              <div className="bg-background rounded-lg border border-border p-3 text-center">
                <Trees className="w-4 h-4 mx-auto mb-1 text-accent" />
                <p className="text-xl font-bold" data-testid="text-parks-count">{analysis.amenities.parks}</p>
                <p className="text-[11px] text-muted-foreground">Parks / Green</p>
              </div>
            </div>
          </div>

        </div>
      </ScrollArea>
    </div>
  );
}