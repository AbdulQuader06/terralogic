import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import SiteSelector from "@/components/bim/SiteSelector";
import BimViewport from "@/components/bim/BimViewport";
import CompliancePanel from "@/components/bim/CompliancePanel";
import MetricsDashboard from "@/components/bim/MetricsDashboard";
import type { SiteData } from "@/components/bim/SiteSelector";
import type { BimMetrics } from "@/components/bim/BimViewport";

export default function BimDesigner() {
  const [, navigate] = useLocation();
  const [siteData, setSiteData] = useState<SiteData | null>(null);
  const [metrics, setMetrics] = useState<BimMetrics | null>(null);
  const [massings, setMassings] = useState<any[]>([]);
  const [sunHour, setSunHour] = useState(12);
  const [complianceScore, setComplianceScore] = useState(0);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const onSiteSelected = useCallback((data: SiteData) => {
    setSiteData(data);
    setMassings([]);
    setMetrics(null);
    setComplianceScore(0);
  }, []);

  const onMetricsUpdate = useCallback((m: BimMetrics) => {
    setMetrics(m);
  }, []);

  const onMassingChange = useCallback((ms: any[]) => {
    setMassings(ms);
  }, []);

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

      pdf.setFillColor(13, 17, 23);
      pdf.rect(0, 0, 210, 297, "F");

      pdf.setTextColor(0, 188, 212);
      pdf.setFontSize(18);
      pdf.text("TerraLogic AI — Construction Brief", margin, y + 5);
      y += 12;
      pdf.setTextColor(150, 150, 150);
      pdf.setFontSize(8);
      pdf.text(`Generated: ${new Date().toLocaleString()} | Autonomous BIM-GIS Hybrid Designer`, margin, y);
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

      pdf.setDrawColor(0, 188, 212);
      pdf.line(margin, y, pageW - margin, y);
      y += 5;

      if (siteData) {
        pdf.setTextColor(0, 188, 212);
        pdf.setFontSize(11);
        pdf.text("Site Data", margin, y);
        y += 5;
        pdf.setTextColor(200, 200, 200);
        pdf.setFontSize(8);
        const siteLines = [
          `Location: ${siteData.center.lat.toFixed(5)}, ${siteData.center.lon.toFixed(5)}`,
          `Elevation: ${siteData.elevation}m | Area: ${(siteData.area / 10000).toFixed(2)} Ha (${Math.round(siteData.area).toLocaleString()} sqm)`,
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
        pdf.setDrawColor(0, 188, 212);
        pdf.line(margin, y, pageW - margin, y);
        y += 5;
        pdf.setTextColor(0, 188, 212);
        pdf.setFontSize(11);
        pdf.text("Design Metrics", margin, y);
        y += 5;
        pdf.setTextColor(200, 200, 200);
        pdf.setFontSize(8);
        const metricLines = [
          `FAR: ${metrics.far.toFixed(2)} (Allowed: 2.5) | Ground Coverage: ${metrics.groundCoverage}% (Allowed: 50%)`,
          `Open Space: ${metrics.openSpace}% (Min: 30%) | Max Height: ${metrics.maxHeight}m (Limit: 45m)`,
          `Total Built-Up: ${metrics.totalBuiltUp.toLocaleString()} sqm | Massings: ${metrics.massingCount} | Est. Units: ${metrics.estimatedUnits}`,
        ];
        for (const line of metricLines) {
          pdf.text(line, margin, y);
          y += 4;
        }
        y += 3;

        const estCost = metrics.totalBuiltUp * 2500 * 0.0929;
        const estRevenue = estCost * 1.35;
        const roi = estCost > 0 ? ((estRevenue - estCost) / estCost * 100) : 0;
        pdf.setDrawColor(0, 188, 212);
        pdf.line(margin, y, pageW - margin, y);
        y += 5;
        pdf.setTextColor(0, 188, 212);
        pdf.setFontSize(11);
        pdf.text("Investment Estimate", margin, y);
        y += 5;
        pdf.setTextColor(200, 200, 200);
        pdf.setFontSize(8);
        pdf.text(`Construction Cost: Rs ${(estCost / 10000000).toFixed(1)} Cr | Est. Revenue: Rs ${(estRevenue / 10000000).toFixed(1)} Cr | ROI: ${roi.toFixed(1)}%`, margin, y);
        y += 8;
      }

      const radarEl = document.querySelector("[data-testid='radar-chart']") as HTMLElement;
      if (radarEl) {
        try {
          const radarCanvas = await html2canvas(radarEl, { backgroundColor: "#0d1117", scale: 2 });
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
          const compCanvas = await html2canvas(compEl, { backgroundColor: "#0d1117", scale: 2 });
          const compImg = compCanvas.toDataURL("image/png");
          const ratio = compCanvas.height / compCanvas.width;
          const cW = contentW;
          const cH = cW * ratio;
          if (y + Math.min(cH, 80) > 280) {
            pdf.addPage();
            pdf.setFillColor(13, 17, 23);
            pdf.rect(0, 0, 210, 297, "F");
            y = margin;
          }
          pdf.addImage(compImg, "PNG", margin, y, cW, Math.min(cH, 80));
        } catch { /* skip */ }
      }

      pdf.setTextColor(80, 80, 80);
      pdf.setFontSize(7);
      pdf.text("TerraLogic AI — Autonomous BIM-GIS Hybrid Designer | For preliminary assessment only", margin, 290);

      pdf.save(`TerraLogic_BIM_Brief_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      console.error("PDF export error:", e);
    } finally {
      setExporting(false);
    }
  }, [siteData, metrics]);

  return (
    <div className="h-screen w-screen bg-[#0d1117] text-gray-200 flex flex-col overflow-hidden" data-testid="bim-designer">
      <header className="h-10 border-b border-cyan-900/30 flex items-center justify-between px-4 bg-black/60 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/")} className="text-gray-500 hover:text-cyan-400 text-sm transition-colors" data-testid="bim-back-btn">
            ← Back
          </button>
          <div className="h-4 w-px bg-cyan-900/40" />
          <h1 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">TerraLogic AI — BIM-GIS Hybrid Designer</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <span>Sun Hour</span>
            <input type="range" min={6} max={18} step={0.5} value={sunHour} onChange={e => setSunHour(+e.target.value)}
              className="w-20 accent-cyan-500" data-testid="bim-sun-slider" />
            <span className="text-cyan-400 font-mono w-10">{sunHour}:00</span>
          </div>
          <button
            onClick={handleExportPDF}
            disabled={exporting || !metrics}
            className="px-3 py-1 rounded text-[10px] font-medium bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            data-testid="bim-export-pdf"
          >
            {exporting ? "Generating..." : "Export Construction Brief"}
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0" ref={exportRef}>
        <aside className="w-[280px] border-r border-cyan-900/30 flex flex-col bg-[#0a0f14] flex-shrink-0 overflow-y-auto">
          <div className="flex-1 min-h-[280px]">
            <SiteSelector onSiteSelected={onSiteSelected} initialCenter={{ lat: 17.4767, lon: 78.4969 }} />
          </div>

          {siteData && (
            <div className="border-t border-cyan-900/30 p-3 space-y-2">
              <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">Site Summary</div>
              <div className="space-y-1 text-[10px]">
                <div className="flex justify-between text-gray-400">
                  <span>Center</span>
                  <span className="text-gray-300 font-mono">{siteData.center.lat.toFixed(4)}, {siteData.center.lon.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Elevation</span>
                  <span className="text-gray-300">{siteData.elevation}m</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Context Buildings</span>
                  <span className="text-gray-300">{siteData.buildingFootprints.length}</span>
                </div>
              </div>
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

        <aside className="w-[280px] border-l border-cyan-900/30 bg-[#0a0f14] flex-shrink-0 overflow-y-auto p-2 space-y-2">
          <CompliancePanel
            siteData={siteData}
            metrics={metrics}
            massings={massings}
            sunHour={sunHour}
            onScoreUpdate={setComplianceScore}
          />
          <MetricsDashboard
            metrics={metrics}
            siteData={siteData}
            complianceScore={complianceScore}
          />
        </aside>
      </div>
    </div>
  );
}
