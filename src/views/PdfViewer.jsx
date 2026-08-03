import { useState, useRef } from 'react';
import { Upload, FileText, X, Download, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function PdfViewer() {
  const [files, setFiles] = useState([]); // { name, url, objectUrl }
  const [activeIdx, setActiveIdx] = useState(null);
  const [zoom, setZoom] = useState(100);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const handleFiles = (incoming) => {
    const pdfs = Array.from(incoming).filter(f => f.type === 'application/pdf');
    const newEntries = pdfs.map(f => ({
      name: f.name,
      objectUrl: URL.createObjectURL(f),
    }));
    setFiles(prev => {
      const updated = [...prev, ...newEntries];
      if (activeIdx === null && updated.length > 0) setActiveIdx(0);
      return updated;
    });
  };

  const removeFile = (idx) => {
    setFiles(prev => {
      URL.revokeObjectURL(prev[idx].objectUrl);
      const updated = prev.filter((_, i) => i !== idx);
      if (activeIdx === idx) setActiveIdx(updated.length > 0 ? 0 : null);
      else if (activeIdx > idx) setActiveIdx(a => a - 1);
      return updated;
    });
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const activeFile = activeIdx !== null ? files[activeIdx] : null;

  return (
    <div className="flex h-full min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold text-sm text-foreground mb-3">PDF Files</h2>
          <Button
            size="sm"
            className="w-full"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="w-3.5 h-3.5 mr-2" />
            Upload PDF
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {files.length === 0 && (
            <p className="text-xs text-muted-foreground text-center mt-6 px-4">
              No files yet. Upload a PDF to get started.
            </p>
          )}
          {files.map((f, i) => (
            <div
              key={i}
              onClick={() => setActiveIdx(i)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer group text-sm transition-colors",
                activeIdx === i
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted text-foreground"
              )}
            >
              <FileText className="w-4 h-4 flex-shrink-0 opacity-70" />
              <span className="flex-1 truncate leading-tight">{f.name}</span>
              <button
                onClick={e => { e.stopPropagation(); removeFile(i); }}
                className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Main viewer */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card">
          {activeFile ? (
            <>
              <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm font-medium truncate flex-1">{activeFile.name}</span>
              <div className="flex items-center gap-1 ml-auto">
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.max(50, z - 25))}>
                  <ZoomOut className="w-3.5 h-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground w-12 text-center tabular-nums">{zoom}%</span>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.min(200, z + 25))}>
                  <ZoomIn className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7 ml-1" asChild>
                  <a href={activeFile.objectUrl} download={activeFile.name} title="Download">
                    <Download className="w-3.5 h-3.5" />
                  </a>
                </Button>
              </div>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">No file selected</span>
          )}
        </div>

        {/* PDF area */}
        <div className="flex-1 overflow-auto bg-muted/30 relative">
          {activeFile ? (
            <div
              className="flex justify-center py-6 px-4 min-h-full"
              style={{ minWidth: `${zoom}%` }}
            >
              <iframe
                key={activeFile.objectUrl + zoom}
                src={activeFile.objectUrl}
                title={activeFile.name}
                className="rounded-lg shadow-lg border border-border bg-white"
                style={{
                  width: `${zoom}%`,
                  minWidth: 400,
                  height: '85vh',
                }}
              />
            </div>
          ) : (
            <div
              className={cn(
                "flex flex-col items-center justify-center h-full min-h-96 m-6 border-2 border-dashed rounded-xl transition-colors",
                dragging ? "border-primary bg-primary/5" : "border-border"
              )}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <Upload className="w-10 h-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-muted-foreground mb-1">Drop a PDF here</p>
              <p className="text-xs text-muted-foreground mb-4">or use the Upload button in the sidebar</p>
              <Button variant="outline" onClick={() => inputRef.current?.click()}>
                Choose File
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}