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
  const [isLooping, setIsLooping] = useState(true);

  const [aspectRatio, setAspectRatio] = useState("16:9");

  // "per photo" duration — derived from totalDesiredSeconds if set
  const [durationMode, setDurationMode] = useState<"per-photo" | "total">("per-photo");
  const [perPhotoDuration, setPerPhotoDuration] = useState("0.6");
  const [totalDesiredSeconds, setTotalDesiredSeconds] = useState("10");

  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [previews, setPreviews] = useState<PreviewFile[]>([]);
  const [compiledDuration, setCompiledDuration] = useState<string | null>(null);

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // ─── Load FFmpeg once ────────────────────────────────────────────────────
  useEffect(() => {
    const loadFFmpeg = async () => {
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
      } catch {
        setStatus("Initialization failed.");
      }
    };
    loadFFmpeg();
  }, []);

  // ─── Generate thumbnails ─────────────────────────────────────────────────
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

  // ─── Sync loop state ─────────────────────────────────────────────────────
  useEffect(() => {
    if (videoRef.current) videoRef.current.loop = isLooping;
  }, [isLooping, videoUrl]);

  // ─── Resolve effective duration per photo ────────────────────────────────
  const fileCount = selectedFiles?.length ?? 0;

  const effectiveDurSec = (() => {
    if (durationMode === "total") {
      const total = parseFloat(totalDesiredSeconds) || 0;
      return fileCount > 0 ? total / fileCount : 0;
    }
    return parseFloat(perPhotoDuration) || 0;
  })();

  const expectedTotal =
    durationMode === "total"
      ? parseFloat(totalDesiredSeconds) || 0
      : fileCount * effectiveDurSec;

  // ─── Generate video ──────────────────────────────────────────────────────
  const handleGenerateVideo = async () => {
    const ffmpeg = ffmpegRef.current;
    if (!selectedFiles || selectedFiles.length === 0 || !ffmpeg) return;
    if (effectiveDurSec <= 0) return;

    setCompiling(true);
    setProgress(0);
    setVideoUrl(null);
    setCompiledDuration(null);
    setStatus("Clearing previous data...");

    try {
      // 1. Clean up leftovers from previous run
      try {
        const files = await ffmpeg.listDir("/");
        for (const f of files) {
          if (f.name.match(/^img\d+\.jpg$/) || f.name === "output.mp4") {
            await ffmpeg.deleteFile(f.name);
          }
        }
      } catch {
        // ignore on first run
      }

      // 2. Write images sequentially
      setStatus("Writing images to memory...");
      for (let i = 0; i < selectedFiles.length; i++) {
        const fileData = await fetchFile(selectedFiles[i]);
        await ffmpeg.writeFile(`img${String(i + 1).padStart(3, "0")}.jpg`, fileData);
      }

      setStatus("Compiling video...");

      // 3. Frame math — always encode at OUTPUT_FPS (25fps)
      //    Each image is held for framesPerImage frames via setpts.
      const framesPerImage = Math.max(1, Math.round(effectiveDurSec * OUTPUT_FPS));
      const totalFrames = selectedFiles.length * framesPerImage;
      const totalDuration = (totalFrames / OUTPUT_FPS).toFixed(6);

      // 4. Crop dimensions
      let targetW = 1920, targetH = 1080;
      if (aspectRatio === "9:16")  { targetW = 1080; targetH = 1920; }
      else if (aspectRatio === "1:1")  { targetW = 1080; targetH = 1080; }
      else if (aspectRatio === "4:3")  { targetW = 1440; targetH = 1080; }
      else if (aspectRatio === "3:4")  { targetW = 1080; targetH = 1440; }

      // 5. Filter chain:
      //    - scale to fill the target size
      //    - crop to exact dimensions
      //    - setpts: multiply PTS so each frame is held for framesPerImage output frames
      //    This is done by feeding input at 1fps (one image per second),
      //    then using setpts to stretch PTS by framesPerImage, giving correct
      //    timestamps at OUTPUT_FPS without any resampler confusion.
      const scaleFilter = `scale=iw*max(${targetW}/iw\\,${targetH}/ih):ih*max(${targetW}/iw\\,${targetH}/ih)`;
      const cropFilter  = `crop=${targetW}:${targetH}`;
      const ptsFilter   = `setpts=${framesPerImage}*N/${OUTPUT_FPS}/TB`;
      const filterString = [scaleFilter, cropFilter, ptsFilter].join(",");

      await ffmpeg.exec([
        "-framerate", "1",          // read 1 image per second from the sequence
        "-i", "img%03d.jpg",
        "-vf", filterString,        // scale + crop + hold each frame
        "-c:v", "libx264",
        "-r", String(OUTPUT_FPS),   // output container runs at 25fps
        "-t", totalDuration,        // hard end time — no extra frames
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        "output.mp4",
      ]);

      const data = await ffmpeg.readFile("output.mp4");
      const blob = new Blob([data as unknown as BlobPart], { type: "video/mp4" });
      setVideoUrl(URL.createObjectURL(blob));
      setCompiledDuration((totalFrames / OUTPUT_FPS).toFixed(1));
      setStatus("Generation Complete!");
    } catch (e) {
      console.error(e);
      setStatus("Compilation Error.");
    } finally {
      setCompiling(false);
    }
  };

  // ────────────────────────────────────────────────────────────────────────
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

            {/* Duration mode toggle */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Duration Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDurationMode("per-photo")}
                  disabled={!ready || compiling}
                  className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                    durationMode === "per-photo"
                      ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                      : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  Per Photo
                </button>
                <button
                  onClick={() => setDurationMode("total")}
                  disabled={!ready || compiling}
                  className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                    durationMode === "total"
                      ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                      : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  Total Duration
                </button>
              </div>
            </div>

            {/* Duration input — changes based on mode */}
            {durationMode === "per-photo" ? (
              <div className="flex flex-col gap-1.5">
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
                {fileCount > 0 && (
                  <p className="text-[11px] text-zinc-500 px-1">
                    {fileCount} photos × {perPhotoDuration}s ={" "}
                    <span className="text-emerald-400 font-semibold">{expectedTotal.toFixed(1)}s total</span>
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Total Video Duration (seconds)
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="600"
                  value={totalDesiredSeconds}
                  onChange={(e) => setTotalDesiredSeconds(e.target.value)}
                  className="w-full p-3 bg-zinc-900 rounded-xl border border-zinc-800 text-sm font-mono text-zinc-200 outline-none focus:border-emerald-500 transition-colors"
                  placeholder="e.g. 30"
                  disabled={!ready || compiling}
                />
                {fileCount > 0 && (
                  <p className="text-[11px] text-zinc-500 px-1">
                    {totalDesiredSeconds}s ÷ {fileCount} photos ={" "}
                    <span className="text-emerald-400 font-semibold">
                      {effectiveDurSec.toFixed(2)}s per photo
                    </span>
                  </p>
                )}
              </div>
            )}

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

            {/* Preview strip + file list */}
            {selectedFiles && selectedFiles.length > 0 && (
              <div className="flex flex-col gap-2 mt-1 p-3 bg-zinc-900/40 border border-zinc-800/80 rounded-xl">
                <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                    Selected ({selectedFiles.length})
                  </span>
                  <span className="text-xs font-mono font-semibold text-emerald-400">
                    {expectedTotal.toFixed(1)}s
                  </span>
                </div>

                {/* Thumbnail strip */}
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

                {/* File name list */}
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

          {/* Video output */}
          {videoUrl && (
            <div className="mt-2 pt-4 border-t border-zinc-800 flex flex-col gap-3">
              {compiledDuration && (
                <div className="flex justify-between items-center text-xs px-1">
                  <span className="text-zinc-500">Compiled duration</span>
                  <span className="font-mono font-semibold text-emerald-400">{compiledDuration}s</span>
                </div>
              )}

              <video
                ref={videoRef}
                src={videoUrl}
                controls
                loop={isLooping}
                autoPlay
                className="w-full rounded-xl border border-zinc-800 shadow-inner bg-black"
              />

              {/* Loop toggle */}
              <button
                onClick={() => setIsLooping((v) => !v)}
                className={`flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-semibold border transition-all ${
                  isLooping
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                    : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
                {isLooping ? "Loop: ON" : "Loop: OFF"}
              </button>

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