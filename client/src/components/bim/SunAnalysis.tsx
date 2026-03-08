import { useState, useEffect, useRef, useCallback } from "react";
import type { SiteData } from "./SiteSelector";

interface SunAnalysisProps {
  siteData: SiteData | null;
  sunHour: number;
  onSunHourChange: (h: number) => void;
}

function getSunPosition(lat: number, lon: number, hour: number, dayOfYear: number) {
  const declination = 23.45 * Math.sin((2 * Math.PI / 365) * (dayOfYear - 81));
  const decRad = declination * Math.PI / 180;
  const latRad = lat * Math.PI / 180;
  const hourAngle = (hour - 12) * 15;
  const haRad = hourAngle * Math.PI / 180;

  const altitude = Math.asin(
    Math.sin(latRad) * Math.sin(decRad) +
    Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad)
  );

  const azimuth = Math.atan2(
    -Math.cos(decRad) * Math.sin(haRad),
    Math.sin(altitude) * Math.sin(latRad) - Math.sin(decRad)
  ) / Math.cos(altitude);

  return {
    altitude: altitude * 180 / Math.PI,
    azimuth: (Math.atan2(
      -Math.cos(decRad) * Math.sin(haRad),
      Math.cos(latRad) * Math.sin(decRad) - Math.sin(latRad) * Math.cos(decRad) * Math.cos(haRad)
    ) * 180 / Math.PI + 360) % 360,
  };
}

function getDirection(azimuth: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(azimuth / 22.5) % 16];
}

export default function SunAnalysis({ siteData, sunHour, onSunHourChange }: SunAnalysisProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const animRef = useRef<ReturnType<typeof setInterval>>();
  const [dayOfYear, setDayOfYear] = useState(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    return Math.floor((now.getTime() - start.getTime()) / 86400000);
  });

  const lat = siteData?.center.lat || 17.47;
  const lon = siteData?.center.lon || 78.49;

  const sunPos = getSunPosition(lat, lon, sunHour, dayOfYear);

  const drawSunPath = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) - 20;

    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "#E2E8F0";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * i / 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = "#94A3B8";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    const cardinals = [
      { label: "N", angle: -Math.PI / 2 },
      { label: "E", angle: 0 },
      { label: "S", angle: Math.PI / 2 },
      { label: "W", angle: Math.PI },
    ];
    for (const c of cardinals) {
      const x = cx + (r + 12) * Math.cos(c.angle);
      const y = cy + (r + 12) * Math.sin(c.angle);
      ctx.fillText(c.label, x, y + 3);
    }

    ctx.fillStyle = "#CBD5E1";
    ctx.font = "8px sans-serif";
    [30, 60, 90].forEach((deg, i) => {
      ctx.fillText(`${deg}°`, cx + 3, cy - r * (i + 1) / 3 + 10);
    });

    ctx.strokeStyle = "#F59E0B";
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    let started = false;
    for (let hr = 5; hr <= 19; hr += 0.25) {
      const sp = getSunPosition(lat, lon, hr, dayOfYear);
      if (sp.altitude < 0) continue;
      const dist = r * (1 - sp.altitude / 90);
      const angle = (sp.azimuth - 90) * Math.PI / 180;
      const x = cx + dist * Math.cos(angle);
      const y = cy + dist * Math.sin(angle);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "#94A3B8";
    ctx.lineWidth = 1;
    const solstices = [172, 355];
    for (const doy of solstices) {
      ctx.beginPath();
      started = false;
      for (let hr = 5; hr <= 19; hr += 0.25) {
        const sp = getSunPosition(lat, lon, hr, doy);
        if (sp.altitude < 0) continue;
        const dist = r * (1 - sp.altitude / 90);
        const angle = (sp.azimuth - 90) * Math.PI / 180;
        const x = cx + dist * Math.cos(angle);
        const y = cy + dist * Math.sin(angle);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (sunPos.altitude > 0) {
      const dist = r * (1 - sunPos.altitude / 90);
      const angle = (sunPos.azimuth - 90) * Math.PI / 180;
      const sx = cx + dist * Math.cos(angle);
      const sy = cy + dist * Math.sin(angle);

      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#F59E0B";
      ctx.fill();
      ctx.strokeStyle = "#FBBF24";
      ctx.lineWidth = 2;
      ctx.stroke();

      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(sx + 10 * Math.cos(a), sy + 10 * Math.sin(a));
        ctx.lineTo(sx + 14 * Math.cos(a), sy + 14 * Math.sin(a));
        ctx.strokeStyle = "#FBBF24";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.fillStyle = "#1F2933";
      ctx.font = "bold 8px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${sunHour}:00`, sx, sy + 22);
    }
  }, [lat, lon, sunHour, dayOfYear, sunPos]);

  useEffect(() => {
    drawSunPath();
  }, [drawSunPath]);

  const toggleAnimation = useCallback(() => {
    if (isAnimating) {
      if (animRef.current) clearInterval(animRef.current);
      setIsAnimating(false);
    } else {
      setIsAnimating(true);
      let h = 6;
      animRef.current = setInterval(() => {
        h += 0.5;
        if (h > 18) h = 6;
        onSunHourChange(h);
      }, 200);
    }
  }, [isAnimating, onSunHourChange]);

  useEffect(() => {
    return () => { if (animRef.current) clearInterval(animRef.current); };
  }, []);

  const shadowLength = sunPos.altitude > 0 ? (1 / Math.tan(sunPos.altitude * Math.PI / 180)) : 0;

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden" data-testid="sun-analysis">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-bold text-primary uppercase tracking-wider">Sun Analysis</h3>
        <button onClick={toggleAnimation}
          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${isAnimating ? "bg-amber-50 text-amber-600 border-amber-200" : "text-muted-foreground border-border hover:bg-muted"}`}
          data-testid="sun-animate-btn">
          {isAnimating ? "Stop" : "Animate"}
        </button>
      </div>

      <div className="p-2">
        <canvas ref={canvasRef} width={220} height={220} className="mx-auto" data-testid="sun-path-canvas" />
      </div>

      <div className="px-3 pb-2 space-y-2">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-muted-foreground">Time of Day</label>
            <span className="text-[10px] font-mono text-foreground">{sunHour}:00</span>
          </div>
          <input type="range" min={6} max={18} step={0.5} value={sunHour}
            onChange={e => onSunHourChange(+e.target.value)}
            className="w-full accent-amber-500" data-testid="sun-hour-slider" />
          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>6 AM</span><span>12 PM</span><span>6 PM</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          <div className="bg-muted/40 rounded p-1.5 border border-border">
            <div className="text-muted-foreground">Altitude</div>
            <div className={`font-medium ${sunPos.altitude > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
              {sunPos.altitude > 0 ? `${sunPos.altitude.toFixed(1)}°` : "Below horizon"}
            </div>
          </div>
          <div className="bg-muted/40 rounded p-1.5 border border-border">
            <div className="text-muted-foreground">Azimuth</div>
            <div className="font-medium text-foreground">
              {sunPos.azimuth.toFixed(1)}° {getDirection(sunPos.azimuth)}
            </div>
          </div>
          <div className="bg-muted/40 rounded p-1.5 border border-border">
            <div className="text-muted-foreground">Shadow Ratio</div>
            <div className="font-medium text-foreground">
              {sunPos.altitude > 0 ? `${shadowLength.toFixed(2)}x` : "N/A"}
            </div>
          </div>
          <div className="bg-muted/40 rounded p-1.5 border border-border">
            <div className="text-muted-foreground">Day of Year</div>
            <div className="font-medium text-foreground">{dayOfYear}</div>
          </div>
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground">Season</label>
          <input type="range" min={1} max={365} value={dayOfYear}
            onChange={e => setDayOfYear(+e.target.value)}
            className="w-full accent-primary" data-testid="sun-day-slider" />
          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>Jan</span><span>Apr</span><span>Jul</span><span>Oct</span><span>Dec</span>
          </div>
        </div>
      </div>
    </div>
  );
}
