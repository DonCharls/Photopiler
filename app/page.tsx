"use client";

import { useState, useEffect, useRef } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

type PreviewFile = { name: string; url: string };

const OUTPUT_FPS = 25;

export default function Home() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Initializing system...");
  const [progress, setProgress] = useState(0);
  const [compiling, setCompiling] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [perPhotoDuration, setPerPhotoDuration] = useState("0.6");
  const [loopCount, setLoopCount] = useState("1");

  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [previews, setPreviews] = useState<PreviewFile[]>([]);

  const ffmpegRef = useRef<FFmpeg | null>(null);

  useEffect(() => {
    const loadFFmpeg = async () => {
      const ffmpeg = new FFmpeg();
      ffmpegRef.current = ffmpeg;
      
      // Applied the progress clamping fix here
      ffmpeg.on("progress", ({ progress }) => {
        let percentage = Math.round(progress * 100);
        if (percentage < 0) percentage = 0;
        if (percentage > 100) percentage = 100;
        if (Number.isNaN(percentage)) percentage = 0;
        setProgress(percentage);
      });

      try {
        await ffmpeg.load({
          coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
          wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
        });
        setReady(true);
        setStatus("Engine Ready");
      } catch {
        setStatus("Initialization failed.");
      }
    };
    loadFFmpeg();
  }, []);

  useEffect(() => {
    if (!selectedFiles || selectedFiles.length === 0) {
      setPreviews([]);
      return;
    }
    const newPreviews = Array.from(selectedFiles).map((file) => ({
      name: file.name,
      url: URL.createObjectURL(file),
    }));
    setPreviews(newPreviews);
    return () => newPreviews.forEach((p) => URL.revokeObjectURL(p.url));
  }, [selectedFiles]);

  const fileCount = selectedFiles?.length ?? 0;
  const durSec = parseFloat(perPhotoDuration) || 0.6;
  const loops = Math.max(1, parseInt(loopCount, 10) || 1);
  const oneCycleSec = fileCount * durSec;
  const actualOutputSec = oneCycleSec * loops;

  const handleGenerateVideo = async () => {
    const ffmpeg = ffmpegRef.current;
    if (!selectedFiles || selectedFiles.length === 0 || !ffmpeg) return;
    if (durSec <= 0 || loops <= 0) return;

    setCompiling(true);
    setProgress(0);
    setVideoUrl(null);
    setStatus("Clearing previous data...");

    try {
      // 1. Clean up ALL previous files cleanly
      try {
        const files = await ffmpeg.listDir("/");
        for (const f of files) {
          if (!f.isDir) await ffmpeg.deleteFile(f.name).catch(() => {});
        }
      } catch {
        // ignore on first run
      }

      // 2. Write each source image safely
      setStatus("Writing images...");
      for (let i = 0; i < selectedFiles.length; i++) {
        const u8 = await fetchFile(selectedFiles[i]);
        // Directly pass the Uint8Array container to ensure valid asset conversion
        await ffmpeg.writeFile(`img${i}.jpg`, new Uint8Array(u8));
      }

      // 3. Build a robust concat list
      let concatList = "";
      for (let loop = 0; loop < loops; loop++) {
        for (let img = 0; img < selectedFiles.length; img++) {
          concatList += `file 'img${img}.jpg'\n`;
          concatList += `duration ${durSec}\n`;
        }
      }
      
      // Repeating the final item explicitly satisfies FFmpeg's read requirements
      concatList += `file 'img${selectedFiles.length - 1}.jpg'\n`;
      await ffmpeg.writeFile("concat.txt", concatList);

      // 4. Crop dimensions
      let targetW = 1920, targetH = 1080;
      if (aspectRatio === "9:16")     { targetW = 1080; targetH = 1920; }
      else if (aspectRatio === "1:1") { targetW = 1080; targetH = 1080; }
      else if (aspectRatio === "4:3") { targetW = 1440; targetH = 1080; }
      else if (aspectRatio === "3:4") { targetW = 1080; targetH = 1440; }

      const scaleFilter = `scale=iw*max(${targetW}/iw\\,${targetH}/ih):ih*max(${targetW}/iw\\,${targetH}/ih)`;
      const cropFilter  = `crop=${targetW}:${targetH}`;

      setStatus("Compiling video...");

      await ffmpeg.exec([
        "-f", "concat",
        "-safe", "0",
        "-i", "concat.txt",
        "-vf", `${scaleFilter},${cropFilter},format=yuv420p`,
        "-c:v", "libx264",
        "-r", String(OUTPUT_FPS),
        "-preset", "ultrafast",
        "-movflags", "+faststart",
        "output.mp4",
      ]);

      setStatus("Reading generated video...");
      
      // --- APPLIED TYPE-SAFE FIX FOR Uint8Array AND SharedArrayBuffer ---
      const rawData = await ffmpeg.readFile("output.mp4");
      
      let finalUint8Array: Uint8Array;
      if (typeof rawData === "string") {
        finalUint8Array = new TextEncoder().encode(rawData);
      } else if (rawData instanceof Uint8Array) {
        finalUint8Array = rawData;
      } else {
        finalUint8Array = new Uint8Array(rawData as unknown as ArrayBuffer);
      }

      // Slice out of SharedArrayBuffer into a clean standard buffer
      const safeBuffer = finalUint8Array.buffer.slice(
        finalUint8Array.byteOffset,
        finalUint8Array.byteOffset + finalUint8Array.byteLength
      );

      // Applied the ArrayBuffer type cast here
      const blob = new Blob([safeBuffer as ArrayBuffer], { type: "video/mp4" });
      // ----------------------------------------------------------------

      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      
      setStatus("Generation Complete!");
    } catch (e) {
      console.error(e);
      setStatus("Compilation Error.");
    } finally {
      setCompiling(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-black text-white font-sans antialiased">
      <div className="w-full max-w-md bg-[#111] rounded-2xl border border-zinc-800 shadow-2xl overflow-hidden">
        <div className="h-[3px] w-full bg-gradient-to-r from-cyan-500 via-emerald-500 to-emerald-400" />

        <div className="p-6 flex flex-col gap-6">
          {/* Header */}
          <div className="text-center flex flex-col gap-1">
            <span className="text-[10px] tracking-[0.2em] font-bold text-emerald-400 uppercase bg-emerald-500/10 px-2.5 py-1 rounded-full mx-auto mb-2 border border-emerald-500/20">
              • WASM CLIENT RENDERING
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">Photopiler</h1>
            <p className="text-xs text-zinc-400 font-medium">
              The instant, serverless photo-loop compiler.
            </p>
          </div>

          {/* Status bar */}
          <div className="flex flex-col gap-2 bg-zinc-900/50 p-3 rounded-xl border border-zinc-800/60">
            <div className="flex justify-between items-center text-xs text-zinc-400 px-1">
              <span>System Status:</span>
              <span className={`font-semibold ${ready ? "text-emerald-400" : "text-amber-400 animate-pulse"}`}>
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

          {/* Controls */}
          <div className="flex flex-col gap-4">

            {/* Aspect ratio */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Aspect Ratio</label>
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

            {/* Sequence Settings */}
            <div className="flex flex-col gap-3 p-3 bg-zinc-900/40 border border-zinc-800/60 rounded-xl">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Sequence Settings</p>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Seconds Per Photo
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="30"
                  value={perPhotoDuration}
                  onChange={(e) => setPerPhotoDuration(e.target.value)}
                  className="w-full p-3 bg-zinc-900 rounded-xl border border-zinc-800 text-sm font-mono text-zinc-200 outline-none focus:border-emerald-500 transition-colors"
                  placeholder="e.g. 0.6"
                  disabled={!ready || compiling}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Number of Loops
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="100"
                  value={loopCount}
                  onChange={(e) => setLoopCount(e.target.value)}
                  className="w-full p-3 bg-zinc-900 rounded-xl border border-zinc-800 text-sm font-mono text-zinc-200 outline-none focus:border-emerald-500 transition-colors"
                  placeholder="e.g. 1"
                  disabled={!ready || compiling}
                />
              </div>

              {/* Live math preview */}
              {fileCount > 0 && durSec > 0 && loops > 0 && (
                <div className="mt-1 p-2.5 bg-zinc-900 rounded-lg border border-zinc-800 text-[11px] text-zinc-400 space-y-1">
                  <div className="flex justify-between">
                    <span>1 cycle ({fileCount} photos × {durSec}s)</span>
                    <span className="font-mono text-zinc-300">{oneCycleSec.toFixed(1)}s</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total loops</span>
                    <span className="font-mono text-zinc-300">×{loops}</span>
                  </div>
                  <div className="flex justify-between border-t border-zinc-800 pt-1">
                    <span className="font-semibold text-zinc-300">Final Video Length</span>
                    <span className="font-mono font-bold text-emerald-400">{actualOutputSec.toFixed(1)}s</span>
                  </div>
                  <div className="pt-1 flex flex-wrap gap-1">
                    {Array.from({ length: Math.min(loops, 20) }).map((_, loopIdx) =>
                      Array.from({ length: fileCount }).map((_, photoIdx) => (
                        <span
                          key={`${loopIdx}-${photoIdx}`}
                          className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                            loopIdx === 0
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : "bg-zinc-800 text-zinc-500 border border-zinc-700"
                          }`}
                        >
                          {photoIdx + 1}
                        </span>
                      ))
                    )}
                    {loops > 20 && <span className="text-[9px] px-1 py-0.5 text-zinc-500">...</span>}
                  </div>
                </div>
              )}
            </div>

            {/* File input */}
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

            {/* Thumbnail strip + file list */}
            {selectedFiles && selectedFiles.length > 0 && (
              <div className="flex flex-col gap-2 p-3 bg-zinc-900/40 border border-zinc-800/80 rounded-xl">
                <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                    Selected ({selectedFiles.length})
                  </span>
                  <span className="text-xs font-mono font-semibold text-emerald-400">
                    {oneCycleSec.toFixed(1)}s / cycle
                  </span>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar-x">
                  {previews.map((p, idx) => (
                    <div key={idx} className="relative flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.url}
                        alt={p.name}
                        className="w-14 h-14 object-cover rounded-lg border border-zinc-700"
                      />
                      <span className="absolute bottom-0.5 left-0.5 text-[9px] font-mono bg-black/70 text-zinc-300 px-1 rounded">
                        {idx + 1}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="max-h-20 overflow-y-auto flex flex-col gap-1 pr-1 custom-scrollbar">
                  {Array.from(selectedFiles).map((file, idx) => (
                    <div key={idx} className="text-[11px] text-zinc-400 truncate flex items-center gap-2">
                      <span className="text-zinc-600 font-mono w-4 text-right">{idx + 1}.</span>
                      <span className="truncate">{file.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Generate button */}
            <button
              onClick={handleGenerateVideo}
              disabled={!ready || compiling || !selectedFiles || durSec <= 0 || loops <= 0}
              className={`w-full mt-2 py-3 px-4 rounded-xl text-sm font-bold tracking-wide transition-all transform active:scale-[0.99] ${
                !ready || compiling || !selectedFiles || durSec <= 0 || loops <= 0
                  ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                  : "bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg shadow-emerald-500/10 font-extrabold"
              }`}
            >
              {compiling ? `Compiling (${progress}%)` : "Generate Video Loop"}
            </button>
          </div>

          {/* Video output */}
          {videoUrl && (
            <div className="mt-2 pt-4 border-t border-zinc-800 flex flex-col gap-3">
              <div className="flex justify-between items-center text-xs px-1">
                <span className="text-zinc-500">Final video length</span>
                <span className="font-mono font-semibold text-emerald-400">{actualOutputSec.toFixed(1)}s</span>
              </div>

              <video
                src={videoUrl}
                controls
                loop
                autoPlay
                className="w-full rounded-xl border border-zinc-800 shadow-inner bg-black"
              />

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

      <style dangerouslySetInnerHTML={{
        __html: `
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 4px; }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #52525b; }
          .custom-scrollbar-x::-webkit-scrollbar { height: 4px; }
          .custom-scrollbar-x::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar-x::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 4px; }
          .custom-scrollbar-x::-webkit-scrollbar-thumb:hover { background: #52525b; }
        `
      }} />
    </main>
  );
}