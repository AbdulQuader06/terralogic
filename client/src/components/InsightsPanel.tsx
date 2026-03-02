import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Building2, 
  Droplets, 
  Trees, 
  GraduationCap, 
  ThermometerSun, 
  MapPin, 
  AlertTriangle,
  CheckCircle2,
  Info
} from "lucide-react";

interface InsightsPanelProps {
  location: { lat: number; lon: number; name: string } | null;
}

export default function InsightsPanel({ location }: InsightsPanelProps) {
  if (!location) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground p-8 text-center">
        <MapPin className="w-12 h-12 mb-4 opacity-20" />
        <h3 className="font-medium text-lg mb-2 text-foreground">No Location Selected</h3>
        <p className="text-sm">Click anywhere on the map or use the search bar to analyze a specific site's suitability.</p>
      </div>
    );
  }

  // Mock data generation based on location
  const suitabilityScore = Math.floor(Math.random() * 40) + 50; // 50-90
  const isHighRisk = suitabilityScore < 60;
  
  const factors = [
    { name: "Flood Risk", value: Math.floor(Math.random() * 100), icon: Droplets, color: "text-destructive" },
    { name: "Soil Stability", value: Math.floor(Math.random() * 100), icon: Trees, color: "text-accent" },
    { name: "Urban Density", value: Math.floor(Math.random() * 100), icon: Building2, color: "text-secondary" },
    { name: "School Proximity", value: Math.floor(Math.random() * 100), icon: GraduationCap, color: "text-primary" },
    { name: "Climate Stress", value: Math.floor(Math.random() * 100), icon: ThermometerSun, color: "text-orange-500" },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-background">
      <div className="p-4 border-b border-border">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          Automated Scoring
        </h2>
        <p className="text-sm text-muted-foreground mt-1 truncate">{location.name}</p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          
          {/* Main Score */}
          <div className="bg-card border border-border rounded-xl p-6 text-center shadow-sm relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-full h-1 ${suitabilityScore >= 75 ? 'bg-accent' : suitabilityScore >= 60 ? 'bg-yellow-500' : 'bg-destructive'}`}></div>
            <h3 className="text-sm text-muted-foreground font-medium uppercase tracking-wider mb-2">Overall Suitability</h3>
            <div className="flex items-end justify-center gap-1">
              <span className={`text-5xl font-bold tracking-tighter ${suitabilityScore >= 75 ? 'text-accent' : suitabilityScore >= 60 ? 'text-yellow-600' : 'text-destructive'}`}>
                {suitabilityScore}
              </span>
              <span className="text-muted-foreground mb-1">/100</span>
            </div>
            
            <div className="mt-4 flex justify-center">
              <Badge variant={suitabilityScore >= 75 ? "default" : suitabilityScore >= 60 ? "secondary" : "destructive"} className="px-3 py-1">
                {suitabilityScore >= 75 ? "Highly Suitable" : suitabilityScore >= 60 ? "Moderate Potential" : "High Risk Area"}
              </Badge>
            </div>
          </div>

          {/* Risk Alerts */}
          {isHighRisk && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive-foreground rounded-lg p-3 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-sm text-destructive">Significant Constraints Detected</h4>
                <p className="text-xs text-destructive/80 mt-1">This site exhibits high climate stress and flood vulnerability. Mitigation costs will be substantial.</p>
              </div>
            </div>
          )}
          
          {!isHighRisk && suitabilityScore >= 75 && (
            <div className="bg-accent/10 border border-accent/20 rounded-lg p-3 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-accent shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-sm text-accent">Optimal Site Conditions</h4>
                <p className="text-xs text-muted-foreground mt-1">Excellent balance of infrastructure proximity and stable environmental factors.</p>
              </div>
            </div>
          )}

          {/* Factors Breakdown */}
          <div>
            <h3 className="font-medium mb-4 flex items-center gap-2">
              <Info className="w-4 h-4 text-muted-foreground" />
              Spatial Factors
            </h3>
            
            <div className="space-y-4">
              {factors.map((factor, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between items-center text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <factor.icon className={`w-4 h-4 ${factor.color}`} />
                      {factor.name}
                    </span>
                    <span className="text-muted-foreground font-mono">{factor.value}%</span>
                  </div>
                  <Progress 
                    value={factor.value} 
                    className="h-2" 
                    indicatorClassName={
                      (factor.name === "Flood Risk" || factor.name === "Climate Stress") 
                        ? (factor.value > 60 ? "bg-destructive" : factor.value > 30 ? "bg-yellow-500" : "bg-accent")
                        : (factor.value < 40 ? "bg-destructive" : factor.value < 70 ? "bg-yellow-500" : "bg-accent")
                    } 
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Infrastructure Summary */}
          <div className="bg-muted rounded-lg p-4">
            <h3 className="font-medium text-sm mb-3">Local Amenities (3km radius)</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background rounded border border-border p-2">
                <p className="text-xl font-bold">{Math.floor(Math.random() * 8) + 1}</p>
                <p className="text-xs text-muted-foreground">Schools</p>
              </div>
              <div className="bg-background rounded border border-border p-2">
                <p className="text-xl font-bold">{Math.floor(Math.random() * 15) + 2}</p>
                <p className="text-xs text-muted-foreground">Transit Stops</p>
              </div>
              <div className="bg-background rounded border border-border p-2">
                <p className="text-xl font-bold">{Math.floor(Math.random() * 4)}</p>
                <p className="text-xs text-muted-foreground">Hospitals</p>
              </div>
              <div className="bg-background rounded border border-border p-2">
                <p className="text-xl font-bold">{Math.floor(Math.random() * 12) + 5}</p>
                <p className="text-xs text-muted-foreground">Parks/Green</p>
              </div>
            </div>
          </div>

        </div>
      </ScrollArea>
    </div>
  );
}