"use client";

import { useState, useEffect, useRef } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

export default function Home() {
  // --- STATE MANAGEMENT ---
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Preparing engine...");
  const [progress, setProgress] = useState(0); // Tracks 0 to 100%
  const [compiling, setCompiling] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  
  // Ref starts as null so it doesn't execute during the Next.js server build phase
  const ffmpegRef = useRef<FFmpeg | null>(null);

  // --- 1. AUTO-INITIALIZE ENGINE ---
  useEffect(() => {
    const loadFFmpeg = async () => {
      // Create the FFmpeg instance ONLY when inside the user's web browser
      const ffmpegInstance = new FFmpeg();
      ffmpegRef.current = ffmpegInstance;

      // Listen to progress for both loading and compiling
      ffmpegInstance.on("progress", ({ progress }) => {
        setProgress(Math.round(progress * 100));
      });

      try {
        setStatus("Downloading video engine (30MB)...");
        await ffmpegInstance.load({
          coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
          wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
        });
        setReady(true);
        setStatus("Engine Ready!");
        setProgress(0); // Reset progress tracking for the compiler step
      } catch (error) {
        console.error("FFmpeg load failed:", error);
        setStatus("Failed to load video engine.");
      }
    };

    loadFFmpeg();
  }, []);

  // --- 2. COMPILE VIDEO FUNCTION ---
  const compileVideo = async (files: FileList) => {
    // Safety guard to ensure files exist and the browser engine is loaded
    if (!files || files.length === 0 || !ffmpegRef.current) return;
    
    setCompiling(true);
    setProgress(0);
    setStatus("Compiling your video... Hang tight!");
    const ffmpeg = ffmpegRef.current;

    try {
      // Write images to virtual memory space
      for (let i = 0; i < files.length; i++) {
        const fileData = await fetchFile(files[i]);
        const fileName = `img${String(i + 1).padStart(3, "0")}.jpg`;
        await ffmpeg.writeFile(fileName, fileData);
      }

      // Aspect Ratio Matrix settings mapping
      let scale = "1920:1080"; // Default 16:9
      if (aspectRatio === "9:16") scale = "1080:1920";
      if (aspectRatio === "1:1") scale = "1080:1080";
      if (aspectRatio === "4:3") scale = "1440:1080";
      if (aspectRatio === "3:4") scale = "1080:1440";

      // Execute scaling and padding operations sequentially
      await ffmpeg.exec([
        "-framerate", "1", 
        "-i", "img%03d.jpg",
        "-vf", `scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2`,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "output.mp4"
      ]);

      // Read final video output (Using explicit type assertion to satisfy Vercel compilation checks)
      const data = await ffmpeg.readFile("output.mp4");
      const blob = new Blob([data as any], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      
      setVideoUrl(url);
      setStatus("Video complete!");
    } catch (error) {
      console.error("Compilation error:", error);
      setStatus("Error compiling video.");
    } finally {
      setCompiling(false);
    }
  };

  // --- 3. UI RENDER ---
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-black text-white">
      <div className="w-full max-w-md p-6 bg-zinc-900 rounded-xl shadow-lg flex flex-col gap-6">
        <h1 className="text-2xl font-bold text-center text-emerald-400">Photopiler</h1>

        {/* PROGRESS BAR & STATUS METRICS */}
        <div className="flex flex-col gap-2">
          <p className="text-sm text-gray-400 text-center">{status}</p>
          {(!ready || compiling) && (
            <div className="w-full bg-zinc-700 rounded-full h-3 overflow-hidden">
              <div 
                className="bg-emerald-500 h-3 rounded-full transition-all duration-300" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          )}
          {(!ready || compiling) && (
            <p className="text-xs text-center text-gray-500">{progress}%</p>
          )}
        </div>

        {/* FUNCTIONAL CONTROLS */}
        {ready && (
          <div className="flex flex-col gap-4">
            
            {/* Dynamic Dropdown for Aspect Ratios */}
            <div className="flex flex-col gap-1">
              <label className="text-sm text-gray-400">Aspect Ratio</label>
              <select 
                value={aspectRatio} 
                onChange={(e) => setAspectRatio(e.target.value)}
                className="p-2 bg-zinc-800 rounded border border-zinc-700 text-sm outline-none focus:border-emerald-500"
                disabled={compiling}
              >
                <option value="16:9">Landscape (16:9)</option>
                <option value="9:16">Portrait (9:16)</option>
                <option value="1:1">Square (1:1)</option>
                <option value="4:3">Classic (4:3)</option>
                <option value="3:4">Vertical Classic (3:4)</option>
              </select>
            </div>

            {/* File Inputs wrapper */}
            <input 
              type="file" 
              multiple 
              accept="image/*"
              disabled={compiling}
              onChange={(e) => {
                if (e.target.files) compileVideo(e.target.files);
              }}
              className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-500/10 file:text-emerald-500 hover:file:bg-emerald-500/20 cursor-pointer"
            />
          </div>
        )}

        {/* MULTIMEDIA DISPLAY ELEMENT */}
        {videoUrl && (
          <div className="mt-4 flex flex-col gap-2">
            <video src={videoUrl} controls className="w-full rounded-lg shadow-md" />
            <a 
              href={videoUrl} 
              download="photopiler-output.mp4" 
              className="text-center w-full bg-zinc-800 hover:bg-zinc-700 text-white py-2 rounded transition-colors text-sm"
            >
              Download MP4
            </a>
          </div>
        )}
      </div>
    </main>
  );
}