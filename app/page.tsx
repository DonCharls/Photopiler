"use client";

import { useState, useRef } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";

export default function Home() {
  // Section 04: State Management Matrix
  const [loaded, setLoaded] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [imageDuration, setImageDuration] = useState<number>(0.6);
  const [totalDuration, setTotalDuration] = useState<number>(14);
  const [aspectRatio, setAspectRatio] = useState<string>("9:16");
  const [status, setStatus] = useState<string>("idle");
  const [videoUrl, setVideoUrl] = useState<string>("");

  const ffmpegRef = useRef<FFmpeg | null>(null);

  // Load local public WASM files from public/ folder (Challenge 02 Fix)
  const loadFFmpeg = async () => {
    setStatus("Loading local FFmpeg Core...");
    const ffmpeg = new FFmpeg();
    
    await ffmpeg.load({
      coreURL: '/ffmpeg-core.js',
      wasmURL: '/ffmpeg-core.wasm',
    });
    
    ffmpegRef.current = ffmpeg;
    setLoaded(true);
    setStatus("Ready to pile some clips!");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setImages(Array.from(e.target.files));
    }
  };

  // Helper function to read uploaded files natively as ArrayBuffer
  const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  const compileVideo = async () => {
    if (!ffmpegRef.current || images.length === 0) return;
    const ffmpeg = ffmpegRef.current;
    setStatus("Processing your loops...");

    // Resolve target pixel dimensions based on chosen aspect ratio
    let width = 1080;
    let height = 1920; 
    if (aspectRatio === "1:1") { width = 1080; height = 1080; }
    if (aspectRatio === "16:9") { width = 1920; height = 1080; }

    try {
      // Section 05: Loop Logic Calculation
      const loopCount = Math.ceil(totalDuration / (images.length * imageDuration));
      let imageIndex = 0;
      const textConfigLines: string[] = [];

      for (let l = 0; l < loopCount; l++) {
        for (let i = 0; i < images.length; i++) {
          const file = images[i];
          const virtualFileName = `img_${imageIndex}.jpg`;
          
          if (l === 0) {
            // Write to Virtual Filesystem (MEMFS) natively using Uint8Array
            const arrayBuffer = await readFileAsArrayBuffer(file);
            await ffmpeg.writeFile(virtualFileName, new Uint8Array(arrayBuffer));
          }
          
          textConfigLines.push(`file 'img_${i}.jpg'`);
          textConfigLines.push(`duration ${imageDuration}`);
          imageIndex++;
        }
      }
      
      // Challenge 04 Fix: Duplicate final frame in manifest to satisfy concat demuxer
      textConfigLines.push(`file 'img_0.jpg'`);
      await ffmpeg.writeFile("input.txt", textConfigLines.join("\n"));

      setStatus("Rendering seamless frames... Please stay on this tab.");

      // Challenge 03 Fix: Center-Crop Scaling string (No stretching, no black bars)
      const filterString = `scale=w=${width}:h=${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;

      // Encode Video Pipeline execution inside the browser
      await ffmpeg.exec([
        "-f", "concat",
        "-safe", "0",
        "-i", "input.txt",
        "-vf", filterString,
        "-pix_fmt", "yuv420p",
        "-c:v", "libx264",
        "-crf", "18", // Crisp High-Definition quality profile
        "output.mp4"
      ]);

      // Read final video output out of browser memory allocation
      const data = await ffmpeg.readFile("output.mp4");
      const blob = new Blob([data as any], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      
      setVideoUrl(url);
      setStatus("Photopiler loop complete!");
    } catch (error) {
      console.error(error);
      setStatus("An error occurred during video compilation.");
    }
  };

  return (
    <main className="min-h-screen bg-[#0a0c0f] text-[#e2e8f0] p-6 flex flex-col items-center selection:bg-emerald-500/30 selection:text-emerald-400 font-sans">
      <div className="max-w-xl w-full bg-[#111418] rounded-xl p-8 border border-[#1e2329] shadow-2xl mt-12 relative overflow-hidden">
        {/* Neon accent bar header line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500 via-emerald-400 to-blue-600"></div>
        
        <header className="text-center mb-8">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#00e5a0] bg-[#00e5a0]/10 border border-[#00e5a0]/20 rounded px-2.5 py-1 mb-3 uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00e5a0] animate-pulse"></span>
            WASM Client Rendering
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-[#00e5a0] bg-clip-text text-transparent">
            Photopiler
          </h1>
          <p className="text-xs text-[#64748b] mt-1 font-medium">
            The instant, serverless photo-loop compiler.
          </p>
        </header>

        {!loaded ? (
          <button 
            onClick={loadFFmpeg} 
            className="w-full bg-gradient-to-r from-[#00e5a0] to-emerald-500 hover:opacity-95 font-semibold text-slate-950 p-3.5 rounded-lg shadow-lg shadow-emerald-500/10 transition active:scale-[0.99]"
          >
            Initialize Video Engine
          </button>
        ) : (
          <div className="space-y-5">
            <div>
              <label className="block text-xs font-mono font-semibold tracking-wider text-[#64748b] uppercase mb-1.5">Select Input Assets</label>
              <div className="border border-dashed border-[#1e2329] bg-[#0d1117] rounded-lg p-4 text-center cursor-pointer hover:border-[#0077ff]/50 transition-colors group">
                <input type="file" multiple accept="image/*" onChange={handleFileChange} className="hidden" id="file-upload"/>
                <label htmlFor="file-upload" className="cursor-pointer block text-sm text-[#94a3b8] group-hover:text-[#e2e8f0]">
                  Click to choose your compile sequence
                </label>
              </div>
              <p className="text-[11px] font-mono text-[#64748b] mt-1.5">{images.length} files currently staged.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-mono font-semibold tracking-wider text-[#64748b] uppercase mb-1.5">Hold Duration (s)</label>
                <input type="number" step="0.1" value={imageDuration} onChange={(e) => setImageDuration(parseFloat(e.target.value))} className="w-full bg-[#0d1117] rounded-md p-2.5 text-white border border-[#1e2329] focus:outline-none focus:border-[#0077ff] font-mono text-sm"/>
              </div>
              <div>
                <label className="block text-xs font-mono font-semibold tracking-wider text-[#64748b] uppercase mb-1.5">Target Video (s)</label>
                <input type="number" value={totalDuration} onChange={(e) => setTotalDuration(parseInt(e.target.value))} className="w-full bg-[#0d1117] rounded-md p-2.5 text-white border border-[#1e2329] focus:outline-none focus:border-[#0077ff] font-mono text-sm"/>
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono font-semibold tracking-wider text-[#64748b] uppercase mb-1.5">Aspect Ratio Matrix</label>
              <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="w-full bg-[#0d1117] rounded-md p-2.5 text-white border border-[#1e2329] focus:outline-none focus:border-[#0077ff] text-sm cursor-pointer">
                <option value="9:16">9:16 — Vertical Format (TikTok / Reels / Shorts)</option>
                <option value="1:1">1:1 — Square Layout (Instagram Grid)</option>
                <option value="16:9">16:9 — Landscape Display (Standard HD)</option>
              </select>
            </div>

            <button 
              onClick={compileVideo} 
              disabled={images.length === 0} 
              className="w-full bg-[#0077ff] hover:bg-[#0077ff]/90 disabled:bg-[#1e2329] disabled:text-[#64748b] font-semibold p-3.5 rounded-lg transition shadow-lg shadow-blue-500/15 active:scale-[0.99] mt-2"
            >
              Generate Compiled Loop
            </button>
          </div>
        )}

        {status !== "idle" && (
          <div className="mt-5 bg-[#0d1117] p-3 rounded border border-[#1e2329] text-xs font-mono text-center text-[#94a3b8]">
            {status}
          </div>
        )}

        {videoUrl && (
          <div className="mt-6 border-t border-[#1e2329] pt-6">
            <h3 className="text-sm font-semibold tracking-wider font-mono text-center mb-3 text-[#64748b] uppercase">Output Matrix Preview</h3>
            <div className="bg-black rounded-lg overflow-hidden border border-[#1e2329] shadow-inner max-w-xs mx-auto">
              <video src={videoUrl} controls className="w-full max-h-96 mx-auto object-contain bg-black" />
            </div>
            <a href={videoUrl} download="photopiler_loop.mp4" className="block text-center mt-4 bg-gradient-to-r from-[#00e5a0] to-emerald-500 text-slate-950 p-2.5 rounded-md text-sm font-bold transition opacity-95 hover:opacity-100">
              Download HD File
            </a>
          </div>
        )}
      </div>
    </main>
  );
}