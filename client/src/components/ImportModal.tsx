import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X, Upload, FileUp, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (data: any, label: string, color: string) => void;
}

const ACCEPTED_FORMATS = ".geojson,.json,.kml,.csv";
const COLORS = ["#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16"];

export default function ImportModal({ open, onClose, onImport }: ImportModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getRandomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setSuccess(null);

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["geojson", "json", "kml", "csv"].includes(ext || "")) {
      setError(`Unsupported format: .${ext}. Use .geojson, .json, .kml, or .csv`);
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setError("File too large. Maximum size is 50 MB.");
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const resp = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }

      const data = await resp.json();
      if (!data.geojson || !data.geojson.features || data.geojson.features.length === 0) {
        throw new Error("No valid features found in file");
      }

      const label = file.name.replace(/\.[^/.]+$/, "");
      const color = getRandomColor();
      onImport(data.geojson, label, color);
      setSuccess(`Imported ${data.geojson.features.length} features from ${file.name}`);
      setTimeout(() => {
        onClose();
        setSuccess(null);
      }, 1500);
    } catch (e: any) {
      setError(e.message || "Failed to import file");
    } finally {
      setIsUploading(false);
    }
  }, [onImport, onClose]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    if (e.target) e.target.value = "";
  }, [handleFile]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-xl shadow-2xl w-[420px] max-w-[90vw] p-6"
        onClick={(e) => e.stopPropagation()}
        data-testid="import-modal"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-close-import"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-lg font-semibold text-foreground mb-1">Upload files to your project</h2>
        <p className="text-xs text-muted-foreground mb-5">Import spatial data to visualize on the map</p>

        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border/60 hover:border-border"
          }`}
          onClick={() => fileInputRef.current?.click()}
          data-testid="import-dropzone"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FORMATS}
            onChange={handleFileInput}
            className="hidden"
            data-testid="input-import-file"
          />

          {isUploading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Processing file...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <FileUp className="w-10 h-10 text-muted-foreground/60" />
              <div>
                <span className="text-sm text-foreground">Drag & Drop or </span>
                <span className="text-sm text-primary font-medium cursor-pointer">Choose files</span>
                <span className="text-sm text-foreground"> to upload</span>
              </div>
              <div className="text-[11px] text-muted-foreground space-y-0.5">
                <p>.csv, .kml, .geojson, .json</p>
                <p>up to 50 MB in EPSG:4326 projection (WGS84)</p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2" data-testid="import-error">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="mt-3 flex items-center gap-2 text-xs rounded-lg px-3 py-2" style={{ color: "#2A9D8F", background: "rgba(42,157,143,0.1)" }} data-testid="import-success">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {success}
          </div>
        )}

        <div className="mt-4 rounded-lg bg-muted/30 px-3 py-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">
            * CSV files should have <strong>lat/latitude</strong> and <strong>lon/lng/longitude</strong> columns
          </p>
        </div>
      </div>
    </div>
  );
}
