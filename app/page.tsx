"use client";

import { useState, useEffect, useRef } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

export default function Home() {
  // --- STATE MANAGEMENT ---
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Initializing system...");
  const [progress, setProgress] = useState(0); 
  const [compiling, setCompiling] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  
  // Custom Controls
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [duration, setDuration] = useState("0.6");
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  
  // Start with a null reference so Next.js doesn't crash during the server build
  const ffmpegRef = useRef<any>(null);

  // --- 1. SILENT BACKGROUND ENGINE INITIALIZATION ---
  useEffect(() => {
    const loadFFmpeg = async () => {
      // Only initialize FFmpeg inside the browser
      const ffmpeg = new FFmpeg();
      ffmpegRef.current = ffmpeg;

      ffmpeg.on("progress", ({ progress }) => {
        setProgress(Math.round(progress * 100));
      });

      try {
        await ffmpeg.load({
          coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
          wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
        });
        setReady(true);
        setStatus("Engine Ready");
      } catch (error) {
        console.error("FFmpeg load failed:", error);
        setStatus("Initialization failed.");
      }
    };

    loadFFmpeg();
  }, []);

  // --- 2. ADVANCED VIDEO COMPILE PIPELINE ---
  const handleGenerateVideo = async () => {
    const ffmpeg = ffmpegRef.current;
    if (!selectedFiles || selectedFiles.length === 0 || !ffmpeg) return;
    
    setCompiling(true);
    setProgress(0);
    setStatus("Processing frames...");

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const fileData = await fetchFile(selectedFiles[i]);
        const fileName = `img${String(i + 1).padStart(3, "0")}.jpg`;
        await ffmpeg.writeFile(fileName, fileData);
      }

      const frameRate = (1 / parseFloat(duration)).toFixed(2);

      let targetW = 1920;
      let targetH = 1080;
      if (aspectRatio === "9:16") { targetW = 1080; targetH = 1920; }
      if (aspectRatio === "1:1")  { targetW = 1080; targetH = 1080; }
      if (aspectRatio === "4:3")  { targetW = 1440; targetH = 1080; }
      if (aspectRatio === "3:4")  { targetW = 1080; targetH = 1440; }

      const filterString = `scale=iw*max(${targetW}/iw\\,${targetH}/ih):ih*max(${targetW}/iw\\,${targetH}/ih),crop=${targetW}:${targetH}`;

      await ffmpeg.exec([
        "-framerate", frameRate,
        "-i", "img%03d.jpg",
        "-vf", filterString,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "output.mp4"
      ]);

      const data = await ffmpeg.readFile("output.mp4");
      const blob = new Blob([data as any], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      
      setVideoUrl(url);
      setStatus("Generation Complete!");
    } catch (error) {
      console.error(error);
      setStatus("Compilation Error.");
    } finally {
      setCompiling(false);
    }
  };

  // --- HELPER: CALCULATE TOTAL VIDEO TIME ---
  const totalVideoTime = selectedFiles 
    ? (selectedFiles.length * parseFloat(duration || "0")).toFixed(1) 
    : "0.0";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-black text-white font-sans antialiased">
      <div className="w-full max-w-md bg-[#111] rounded-2xl border border-zinc-850 shadow-2xl overflow-hidden relative">
        <div className="h-[3px] w-full bg-gradient-to-r from-cyan-500 via-emerald-500 to-emerald-400" />

        <div className="p-6 flex flex-col gap-6">
          <div className="text-center flex flex-col gap-1">
            <span className="text-[10px] tracking-[0.2em] font-bold text-emerald-400 uppercase bg-emerald-500/10 px-2.5 py-1 rounded-full mx-auto mb-2 border border-emerald-500/20">
              • WASM CLIENT RENDERING
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">
              Photopiler
            </h1>
            <p className="text-xs text-zinc-400 font-medium">
              The instant, serverless photo-loop compiler.
            </p>
          </div>

          <div className="flex flex-col gap-2 bg-zinc-900/50 p-3 rounded-xl border border-zinc-800/60">
            <div className="flex justify-between items-center text-xs text-zinc-400 px-1">
              <span>System Status:</span>
              <span className={`font-semibold ${ready ? 'text-emerald-400' : 'text-amber-400 animate-pulse'}`}>
                {status}
              </span>
            </div>
            
            {compiling && (
              <div className="mt-1 flex flex-col gap-1.5">
                <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="bg-emerald-400 h-1.5 rounded-full transition-all duration-300 ease-out" 
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-[10px] text-zinc-500 text-right font-mono">{progress}% compiled</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Aspect Ratio Matrix</label>
              <select 
                value={aspectRatio} 
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full p-3 bg-zinc-900 rounded-xl border border-zinc-800 text-sm font-medium text-zinc-200 outline-none focus:border-emerald-500 transition-colors cursor-pointer"
                disabled={!ready || compiling}
              >
                <option value="16:9">Landscape (16:9)</option>
                <option value="9:16">Portrait (9:16)</option>
                <option value="1:1">Square (1:1)</option>
                <option value="4:3">Classic Standard (4:3)</option>
                <option value="3:4">Vertical Classic (3:4)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Photo Duration (Seconds)</label>
              </div>
              <input 
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="w-full p-3 bg-zinc-900 rounded-xl border border-zinc-800 text-sm font-mono text-zinc-200 outline-none focus:border-emerald-500 transition-colors"
                placeholder="e.g. 0.6"
                disabled={!ready || compiling}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Select Images</label>
              <input 
                type="file" 
                multiple 
                accept="image/*"
                disabled={!ready || compiling}
                onChange={(e) => setSelectedFiles(e.target.files)}
                className="block w-full text-xs text-zinc-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-zinc-800 file:text-zinc-200 hover:file:bg-zinc-700 cursor-pointer border border-zinc-800 p-2 rounded-xl bg-zinc-900/30"
              />
            </div>

            {/* NEW FEATURE: FILE PREVIEW & TOTAL DURATION CALCULATION */}
            {selectedFiles && selectedFiles.length > 0 && (
              <div className="flex flex-col gap-2 mt-1 p-3 bg-zinc-900/40 border border-zinc-800/80 rounded-xl">
                <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Selected Files ({selectedFiles.length})</span>
                  <span className="text-xs font-mono font-semibold text-emerald-400">
                    Total Video: {totalVideoTime}s
                  </span>
                </div>
                <div className="max-h-28 overflow-y-auto flex flex-col gap-1 pr-1 custom-scrollbar">
                  {Array.from(selectedFiles).map((file, idx) => (
                    <div key={idx} className="text-[11px] text-zinc-400 truncate flex items-center gap-2">
                      <span className="text-zinc-600 font-mono w-4 text-right">{idx + 1}.</span>
                      <span className="truncate">{file.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleGenerateVideo}
              disabled={!ready || compiling || !selectedFiles}
              className={`w-full mt-2 py-3 px-4 rounded-xl text-sm font-bold tracking-wide transition-all transform active:scale-[0.99] ${
                !ready || compiling || !selectedFiles
                  ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                  : "bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg shadow-emerald-500/10 font-extrabold"
              }`}
            >
              {compiling ? `Compiling (${progress}%)` : "Generate Video Loop"}
            </button>
          </div>

          {videoUrl && (
            <div className="mt-2 pt-4 border-t border-zinc-800 flex flex-col gap-3 animate-fadeIn">
              <video src={videoUrl} controls className="w-full rounded-xl border border-zinc-800 shadow-inner bg-black" />
              <a 
                href={videoUrl} 
                download="photopiler-output.mp4" 
                className="text-center w-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 font-semibold py-2.5 rounded-xl transition-all text-xs tracking-wide"
              >
                Download Compiled Video
              </a>
            </div>
          )}
        </div>
      </div>
      
      {/* Scrollbar styling for the file list */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #52525b; }
      `}} />
    </main>
  );
}