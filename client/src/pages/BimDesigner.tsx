import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import SiteSelector from "@/components/bim/SiteSelector";
import BimViewport from "@/components/bim/BimViewport";
import CompliancePanel from "@/components/bim/CompliancePanel";
import MetricsDashboard from "@/components/bim/MetricsDashboard";
import SunAnalysis from "@/components/bim/SunAnalysis";
import ChatPanel from "@/components/ChatPanel";
import UserNav from "@/components/UserNav";
import type { MapAction } from "@/components/ChatPanel";
import type { SiteData } from "@/components/bim/SiteSelector";
import type { BimMetrics } from "@/components/bim/BimViewport";
import { Button } from "@/components/ui/button";

type RightTab = "compliance" | "sun" | "chat";

interface EnvelopeResult {
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
}

const DEFAULT_LIMITS = { far: 2.5, groundCoverage: 50, openSpace: 30, maxHeight: 45 };

export default function BimDesigner() {
  const [, navigate] = useLocation();
  const [siteData, setSiteData] = useState<SiteData | null>(null);
  const [metrics, setMetrics] = useState<BimMetrics | null>(null);
  const [massings, setMassings] = useState<any[]>([]);
  const [sunHour, setSunHour] = useState(12);
  const [complianceScore, setComplianceScore] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("compliance");
  const [dynamicLimits, setDynamicLimits] = useState<typeof DEFAULT_LIMITS>(DEFAULT_LIMITS);
  const [maxEnvelope, setMaxEnvelope] = useState<EnvelopeResult | null>(null);

  const prevSiteCenterRef = useRef<{lat:number;lon:number} | null>(null);

  const onSiteSelected = useCallback(async (data: SiteData) => {
    const prev = prevSiteCenterRef.current;
    const siteChanged = !prev ||
      Math.abs(data.center.lat - prev.lat) > 0.0001 ||
      Math.abs(data.center.lon - prev.lon) > 0.0001;
    prevSiteCenterRef.current = { lat: data.center.lat, lon: data.center.lon };
    setSiteData(data);
    if (siteChanged) {
      setMassings([]);
      setMetrics(null);
      setComplianceScore(0);
      setMaxEnvelope(null);
      setDynamicLimits(DEFAULT_LIMITS);
      // Fetch max compliant envelope & dynamic limits immediately after site selection
      try {
        const poly = data.sitePolygon;
        let width: number | undefined;
        let depth: number | undefined;
        if (poly && poly.length >= 3) {
          const lats = poly.map((p: [number, number]) => p[0]);
          const lons = poly.map((p: [number, number]) => p[1]);
          const centerLat = (Math.max(...lats) + Math.min(...lats)) / 2;
          const mPerDegLat = 111320;
          const mPerDegLon = 111320 * Math.cos(centerLat * Math.PI / 180);
          width = (Math.max(...lons) - Math.min(...lons)) * mPerDegLon;
          depth = (Math.max(...lats) - Math.min(...lats)) * mPerDegLat;
        }
        const params = new URLSearchParams({ siteArea: String(Math.round(data.area)) });
        if (width && depth) { params.set("width", String(width)); params.set("depth", String(depth)); }
        const resp = await fetch(`/api/bim/envelope?${params.toString()}`);
        if (resp.ok) {
          const json = await resp.json();
          if (json?.envelope) {
            const env: EnvelopeResult = json.envelope;
            setMaxEnvelope(env);
            setDynamicLimits({
              far: env.farLimit,
              groundCoverage: env.groundCoverageLimit,
              openSpace: env.openSpaceMinimum,
              maxHeight: env.maxHeightLimit,
            });
          }
        }
      } catch (e) {
        console.warn("[bim-designer] Failed to prefetch envelope:", e);
      }
    }
  }, []);

  const onMetricsUpdate = useCallback((m: BimMetrics) => {
    setMetrics(m);
  }, []);

  const onMassingChange = useCallback((ms: any[]) => {
    setMassings(ms);
  }, []);

  const onLimitsUpdate = useCallback((limits: any, envelope?: EnvelopeResult) => {
    if (limits) setDynamicLimits({
      far: limits.far,
      groundCoverage: limits.groundCoverage,
      openSpace: limits.openSpace,
      maxHeight: limits.maxHeight,
    });
    if (envelope) setMaxEnvelope(envelope);
  }, []);

  const handleMapAction = useCallback((action: MapAction) => {
  }, []);

  const chatLocation = siteData ? {
    lat: siteData.center.lat,
    lon: siteData.center.lon,
    name: `BIM Site (${siteData.center.lat.toFixed(4)}, ${siteData.center.lon.toFixed(4)})`,
  } : { lat: 17.4767, lon: 78.4969, name: "Hyderabad, India" };

  const handleExportPDF = useCallback(async () => {
    setExporting(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = 210;
      const margin = 15;
      const contentW = pageW - margin * 2;
      let y = margin;

      pdf.setFillColor(247, 249, 251);
      pdf.rect(0, 0, 210, 297, "F");

      pdf.setTextColor(44, 82, 130);
      pdf.setFontSize(18);
      pdf.text("TerraLogic AI — Construction Brief", margin, y + 5);
      y += 12;
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(8);
      pdf.text(`Generated: ${new Date().toLocaleString()} | BIM-GIS Hybrid Designer`, margin, y);
      y += 10;

      const viewportCanvas = document.querySelector("[data-testid='bim-viewport'] canvas") as HTMLCanvasElement;
      if (viewportCanvas) {
        try {
          const imgData = viewportCanvas.toDataURL("image/png");
          const ratio = viewportCanvas.height / viewportCanvas.width;
          const imgW = contentW;
          const imgH = imgW * ratio;
          pdf.addImage(imgData, "PNG", margin, y, imgW, Math.min(imgH, 90));
          y += Math.min(imgH, 90) + 5;
        } catch { /* skip */ }
      }

      pdf.setDrawColor(44, 82, 130);
      pdf.line(margin, y, pageW - margin, y);
      y += 5;

      if (siteData) {
        pdf.setTextColor(44, 82, 130);
        pdf.setFontSize(11);
        pdf.text("Site Data", margin, y);
        y += 5;
        pdf.setTextColor(31, 41, 51);
        pdf.setFontSize(8);
        const siteLines = [
          `Location: ${siteData.center.lat.toFixed(5)}, ${siteData.center.lon.toFixed(5)}`,
          `Elevation: ${siteData.elevation}m | Area: ${Math.round(siteData.area).toLocaleString()} sqm`,
          `Context Buildings: ${siteData.buildingFootprints.length}`,
          `Amenities — Healthcare: ${siteData.amenities.hospitals} | Education: ${siteData.amenities.schools} | Transit: ${siteData.amenities.transit} | Parks: ${siteData.amenities.parks} | F&B: ${siteData.amenities.restaurants} | Retail: ${siteData.amenities.shops}`,
        ];
        for (const line of siteLines) {
          pdf.text(line, margin, y);
          y += 4;
        }
        y += 3;
      }

      if (metrics) {
        const limits = dynamicLimits || DEFAULT_LIMITS;
        pdf.setDrawColor(44, 82, 130);
        pdf.line(margin, y, pageW - margin, y);
        y += 5;
        pdf.setTextColor(44, 82, 130);
        pdf.setFontSize(11);
        pdf.text("Design Metrics", margin, y);
        y += 5;
        pdf.setTextColor(31, 41, 51);
        pdf.setFontSize(8);
        const metricLines = [
          `FAR: ${metrics.far.toFixed(2)} (Allowed: ${limits.far}) | Ground Coverage: ${metrics.groundCoverage}% (Allowed: ${limits.groundCoverage}%)`,
          `Open Space: ${metrics.openSpace}% (Min: ${limits.openSpace}%) | Max Height: ${metrics.maxHeight}m (Limit: ${limits.maxHeight}m)`,
          `Total Built-Up: ${metrics.totalBuiltUp.toLocaleString()} sqm | Massings: ${metrics.massingCount} | Est. Units: ${metrics.estimatedUnits}`,
        ];
        if (maxEnvelope) {
          metricLines.push(
            `Max Compliant Envelope: Footprint ${maxEnvelope.maxFootprintArea.toLocaleString()} sqm | Built-Up ${maxEnvelope.maxBuiltUpArea.toLocaleString()} sqm | ${maxEnvelope.theoreticalFloors} storeys max at this coverage`
          );
          metricLines.push(
            `Required Setbacks (max envelope): Front ≥ ${maxEnvelope.setbacks.front}m, Rear/Side ≥ ${maxEnvelope.setbacks.rearSide}m`
          );
        }
        for (const line of metricLines) {
          pdf.text(line, margin, y);
          y += 4;
        }
        y += 3;

        const estCost = metrics.totalBuiltUp * 2500 * 0.0929;
        const estRevenue = estCost * 1.35;
        const roi = estCost > 0 ? ((estRevenue - estCost) / estCost * 100) : 0;
        pdf.setDrawColor(44, 82, 130);
        pdf.line(margin, y, pageW - margin, y);
        y += 5;
        pdf.setTextColor(44, 82, 130);
        pdf.setFontSize(11);
        pdf.text("Investment Estimate", margin, y);
        y += 5;
        pdf.setTextColor(31, 41, 51);
        pdf.setFontSize(8);
        pdf.text(`Construction Cost: Rs ${(estCost / 10000000).toFixed(1)} Cr | Est. Revenue: Rs ${(estRevenue / 10000000).toFixed(1)} Cr | ROI: ${roi.toFixed(1)}%`, margin, y);
        y += 8;
      }

      const radarEl = document.querySelector("[data-testid='radar-chart']") as HTMLElement;
      if (radarEl) {
        try {
          const radarCanvas = await html2canvas(radarEl, { backgroundColor: "#ffffff", scale: 2 });
          const radarImg = radarCanvas.toDataURL("image/png");
          const ratio = radarCanvas.height / radarCanvas.width;
          const rW = contentW * 0.5;
          const rH = rW * ratio;
          pdf.addImage(radarImg, "PNG", margin + contentW / 4, y, rW, Math.min(rH, 60));
          y += Math.min(rH, 60) + 5;
        } catch { /* skip */ }
      }

      const compEl = document.querySelector("[data-testid='compliance-panel']") as HTMLElement;
      if (compEl && y < 250) {
        try {
          const compCanvas = await html2canvas(compEl, { backgroundColor: "#ffffff", scale: 2 });
          const compImg = compCanvas.toDataURL("image/png");
          const ratio = compCanvas.height / compCanvas.width;
          const cW = contentW;
          const cH = cW * ratio;
          if (y + Math.min(cH, 80) > 280) {
            pdf.addPage();
            pdf.setFillColor(247, 249, 251);
            pdf.rect(0, 0, 210, 297, "F");
            y = margin;
          }
          pdf.addImage(compImg, "PNG", margin, y, cW, Math.min(cH, 80));
        } catch { /* skip */ }
      }

      pdf.setTextColor(148, 163, 184);
      pdf.setFontSize(7);
      pdf.text("TerraLogic AI — BIM-GIS Hybrid Designer | For preliminary assessment only", margin, 290);

      pdf.save(`TerraLogic_BIM_Brief_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      console.error("PDF export error:", e);
    } finally {
      setExporting(false);
    }
  }, [siteData, metrics, dynamicLimits, maxEnvelope]);

  return (
    <div className="h-screen w-screen bg-background text-foreground flex flex-col overflow-hidden" data-testid="bim-designer">
      <header className="h-11 border-b border-border flex items-center justify-between px-4 bg-card flex-shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/")} className="text-muted-foreground hover:text-primary text-sm transition-colors flex items-center gap-1" data-testid="bim-back-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
            Back
          </button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
              <path d="m12 2 10 6.5v7L12 22 2 15.5v-7L12 2z"/><path d="M12 22V15.5"/><path d="m22 8.5-10 7-10-7"/>
            </svg>
            <span className="text-xs font-bold text-primary uppercase tracking-wider">BIM-GIS Hybrid Designer</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={handleExportPDF}
            disabled={exporting || !metrics}
            variant="outline"
            className="text-xs h-7 px-3"
            data-testid="bim-export-pdf"
          >
            {exporting ? "Generating..." : "Export Brief"}
          </Button>
          <div className="h-5 w-px bg-border" aria-hidden />
          <UserNav />
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="w-[280px] border-r border-border flex flex-col bg-card flex-shrink-0 overflow-y-auto">
          <SiteSelector onSiteSelected={onSiteSelected} initialCenter={{ lat: 17.4767, lon: 78.4969 }} />

          {siteData && (
            <div className="border-t border-border p-3 space-y-2">
              <div className="text-[10px] font-bold text-primary uppercase tracking-wider">Site Summary</div>
              <div className="space-y-1 text-[10px]">
                <div className="flex justify-between text-muted-foreground">
                  <span>Center</span>
                  <span className="text-foreground font-mono">{siteData.center.lat.toFixed(4)}, {siteData.center.lon.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Elevation</span>
                  <span className="text-foreground">{siteData.elevation}m</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Context Buildings</span>
                  <span className="text-foreground">{siteData.buildingFootprints.length}</span>
                </div>
              </div>
            </div>
          )}

          {siteData && siteData.buildingFootprints.length > 0 && (
            <div className="border-t border-border p-3 space-y-1.5 max-h-[200px] overflow-y-auto">
              <div className="text-[10px] font-bold text-primary uppercase tracking-wider">
                Existing Buildings ({siteData.buildingFootprints.filter(b => b.height > 0 || b.floors > 0).length} with height data)
              </div>
              {siteData.buildingFootprints.filter(b => b.height > 0 || b.floors > 0 || b.name).slice(0, 20).map(bld => (
                <div key={bld.id} className="flex items-center justify-between text-[10px] px-1.5 py-1 bg-muted/30 rounded border border-border">
                  <span className="text-foreground truncate max-w-[120px]">{bld.name || bld.type}</span>
                  <span className="text-muted-foreground font-mono">
                    {bld.height > 0 ? `${bld.height}m` : bld.floors > 0 ? `${bld.floors}F (~${bld.floors * 3}m)` : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>

        <main className="flex-1 min-w-0 relative">
          <BimViewport
            siteData={siteData}
            onMetricsUpdate={onMetricsUpdate}
            onMassingChange={onMassingChange}
            sunHour={sunHour}
          />
        </main>

        <aside className="w-[290px] border-l border-border bg-card flex-shrink-0 flex flex-col overflow-hidden">
          <div className="flex border-b border-border bg-muted/30 flex-shrink-0">
            {([
              { key: "compliance" as RightTab, label: "Compliance" },
              { key: "sun" as RightTab, label: "Sun" },
              { key: "chat" as RightTab, label: "CartoAI" },
            ]).map(tab => (
              <button key={tab.key} onClick={() => setRightTab(tab.key)}
                className={`flex-1 px-2 py-2 text-[11px] font-medium transition-colors border-b-2 ${
                  rightTab === tab.key
                    ? "text-primary border-primary bg-card"
                    : "text-muted-foreground border-transparent hover:text-foreground"
                }`}
                data-testid={`bim-tab-${tab.key}`}>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {rightTab === "compliance" && (
              <>
                <CompliancePanel
                  siteData={siteData}
                  metrics={metrics}
                  massings={massings}
                  sunHour={sunHour}
                  onScoreUpdate={setComplianceScore}
                  onLimitsUpdate={onLimitsUpdate}
                />
                <MetricsDashboard
                  metrics={metrics}
                  siteData={siteData}
                  complianceScore={complianceScore}
                  dynamicLimits={dynamicLimits}
                />
              </>
            )}

            {rightTab === "sun" && (
              <SunAnalysis
                siteData={siteData}
                sunHour={sunHour}
                onSunHourChange={setSunHour}
              />
            )}

            {rightTab === "chat" && (
              <div className="h-full flex flex-col -m-2">
                <ChatPanel
                  location={chatLocation}
                  onMapAction={handleMapAction}
                />
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
