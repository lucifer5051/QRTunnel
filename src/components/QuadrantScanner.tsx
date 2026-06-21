import { useEffect, useRef, useState, useMemo } from "react";
import jsQR from "jsqr";
import { Camera, RefreshCw } from "lucide-react";

interface QuadrantScannerProps {
  onQrScanned: (data: string, quadrantIndex: number) => void;
  isActive: boolean;
}

export function QuadrantScanner({ onQrScanned, isActive }: QuadrantScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState(false);

  // Keep track of which quadrants successfully scanned in the last 200ms for visual feedback
  const [activeFlashes, setActiveFlashes] = useState<boolean[]>([false, false, false, false]);
  const flashTimers = useRef<(NodeJS.Timeout | null)[]>([null, null, null, null]);

  // Request cameras list
  useEffect(() => {
    if (!isActive) return;

    async function initDevices() {
      try {
        // Trigger generic permission request
        await navigator.mediaDevices.getUserMedia({ video: true });
        const deviceList = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = deviceList.filter((d) => d.kind === "videoinput");
        setDevices(videoDevices);
        if (videoDevices.length > 0) {
          setSelectedDeviceId(videoDevices[0].deviceId);
        }
      } catch (err: any) {
        setCameraError(
          "Webcam access denied or unavailable. Please enable camera permissions in your browser and try again."
        );
        console.error("Camera list listing error:", err);
      }
    }
    initDevices();
  }, [isActive]);

  // Handle active webcam stream
  useEffect(() => {
    if (!isActive || !selectedDeviceId) {
      if (videoRef.current && videoRef.current.srcObject) {
         const stream = videoRef.current.srcObject as MediaStream;
         stream.getTracks().forEach(track => track.stop());
         videoRef.current.srcObject = null;
      }
      return;
    }

    let activeStream: MediaStream | null = null;
    setIsCameraLoading(true);
    setCameraError(null);

    navigator.mediaDevices
      .getUserMedia({
        video: {
          deviceId: { exact: selectedDeviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })
      .then((stream) => {
        activeStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setIsCameraLoading(false);
      })
      .catch((err) => {
        // Fallback without deviceId
        navigator.mediaDevices
          .getUserMedia({
            video: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          })
          .then((stream) => {
            activeStream = stream;
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
            }
            setIsCameraLoading(false);
          })
          .catch((fallbackErr) => {
            console.error("Camera access failed:", fallbackErr);
            setCameraError("Failed to initiate camera. Check physical connections or permission policies.");
            setIsCameraLoading(false);
          });
      });

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [isActive, selectedDeviceId]);

  // Main high-speed decoding loop
  useEffect(() => {
    if (!isActive) return;

    let animationFrameId: number;
    let lastScanTime = 0;
    const SCAN_INTERVAL = 45; // scan ~22 times a second (45ms). High performance.

    function triggerFlash(idx: number) {
      setActiveFlashes((prev) => {
        const next = [...prev];
        next[idx] = true;
        return next;
      });

      if (flashTimers.current[idx]) {
        clearTimeout(flashTimers.current[idx]!);
      }

      flashTimers.current[idx] = setTimeout(() => {
        setActiveFlashes((prev) => {
          const next = [...prev];
          next[idx] = false;
          return next;
        });
        flashTimers.current[idx] = null;
      }, 150);
    }

    function processFrame(time: number) {
      if (!videoRef.current || !canvasRef.current) {
        animationFrameId = requestAnimationFrame(processFrame);
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      // Check if video frame is ready
      if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
        if (time - lastScanTime >= SCAN_INTERVAL) {
          lastScanTime = time;

          // Align canvas size with current video frame
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }

          // Draw active video segment to hidden scan canvas
          ctx.drawImage(video, 0, 0, w, h);

          // We now split the frame into 4 overlapping quadrants to capture the 2x2 grid.
          // In order to be robust to zoom levels and boundaries, we let quadrants cover slightly
          // more than exact 50%, e.g., 55% of the frame with a minor overlap.
          const qw = Math.floor(w * 0.55);
          const qh = Math.floor(h * 0.55);

          const quadrants = [
            { id: 0, title: "Top Left", x: 0, y: 0, w: qw, h: qh },
            { id: 1, title: "Top Right", x: w - qw, y: 0, w: qw, h: qh },
            { id: 2, title: "Bottom Left", x: 0, y: h - qh, w: qw, h: qh },
            { id: 3, title: "Bottom Right", x: w - qw, y: h - qh, w: qw, h: qh },
          ];

          // 1. Scan individual quadrants in parallel
          for (const quad of quadrants) {
            try {
              const imgData = ctx.getImageData(quad.x, quad.y, quad.w, quad.h);
              const code = jsQR(imgData.data, imgData.width, imgData.height, {
                inversionAttempts: "dontInvert"
              });
              if (code && code.data) {
                // Trigger callbacks up to parent state machine
                onQrScanned(code.data, quad.id);
                triggerFlash(quad.id);
              }
            } catch (err) {
              // Fail silently for canvas boundary issues during resize
            }
          }

          // 2. Fallback full frame scan (primarily helpful for matching single ACK codes or misaligned grids)
          try {
            const fullImgData = ctx.getImageData(0, 0, w, h);
            const fullCode = jsQR(fullImgData.data, fullImgData.width, fullImgData.height, {
              inversionAttempts: "dontInvert"
            });
            if (fullCode && fullCode.data) {
              onQrScanned(fullCode.data, 4); // index 4 represents full frame match
              // Flash all quadrants as a visual feedback in acknowledgment helper
              triggerFlash(0);
              triggerFlash(1);
              triggerFlash(2);
              triggerFlash(3);
            }
          } catch (e) {}
        }
      }

      animationFrameId = requestAnimationFrame(processFrame);
    }

    animationFrameId = requestAnimationFrame(processFrame);

    return () => {
      cancelAnimationFrame(animationFrameId);
      flashTimers.current.forEach(timer => {
        if (timer) clearTimeout(timer);
      });
    };
  }, [isActive, onQrScanned]);

  return (
    <div className="flex flex-col gap-4 bg-[#0f1218] text-gray-100 p-5 rounded-2xl shadow-2xl border border-gray-800 w-full max-w-xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-blue-500" />
          <h3 className="font-semibold text-sm tracking-wide uppercase text-white font-mono">Webcam Optical Input</h3>
        </div>
        
        {devices.length > 1 && (
          <div className="flex items-center gap-1">
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="bg-[#050608] text-xs border border-gray-800 rounded px-2.5 py-1 text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
            >
              {devices.map((device, i) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Main Cam Container */}
      <div className="relative aspect-video rounded-xl bg-[#050608] overflow-hidden border border-gray-800 flex items-center justify-center">
        {isCameraLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[#050608]/85">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="text-xs text-gray-400 font-mono">Loading Camera Stream...</span>
          </div>
        )}

        {cameraError && (
          <div className="absolute inset-0 z-20 p-6 flex flex-col items-center justify-center text-center bg-[#050608]/90">
            <p className="text-amber-500 text-xs font-semibold mb-2">Camera Integration Alert</p>
            <p className="text-gray-400 text-xs max-w-sm font-sans leading-relaxed">{cameraError}</p>
          </div>
        )}

        {/* Live Video Render */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover origin-center"
        />

        {/* Dynamic 2x2 Overlay Guide Lines */}
        <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between p-1">
          {/* Vertical and Horizontal Split Guides */}
          <div className="absolute inset-0 border border-gray-800/40" />
          <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-blue-500/20 shadow-sm border-dashed" />
          <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-blue-500/20 shadow-sm border-dashed" />

          {/* Active Quadrant Flashes border overlay */}
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
            {[0, 1, 2, 3].map((quadIdx) => (
              <div
                key={quadIdx}
                className={`transition-colors duration-150 relative m-1 rounded-sm border ${
                  activeFlashes[quadIdx]
                    ? "border-emerald-400 bg-emerald-500/10 shadow-lg shadow-emerald-500/10"
                    : "border-transparent"
                }`}
              >
                {activeFlashes[quadIdx] && (
                  <span className="absolute top-1.5 left-1.5 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Guidelines framing overlay card */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4/5 h-4/5 border border-white/10 rounded-lg flex items-center justify-center">
            <span className="text-[10px] text-gray-400 font-mono tracking-widest uppercase bg-[#050608]/80 px-2 py-0.5 rounded border border-gray-800/50">
              Align 2x2 multi-qr screen area inside here
            </span>
          </div>
        </div>
      </div>

      <div className="text-center text-[10px] text-gray-500 font-mono leading-relaxed px-2 flex justify-between uppercase">
        <span>Frame Rate: ~22 scans/s</span>
        <span className="text-gray-400">Cropped Quadrant Parallel Decoder Mode Active</span>
      </div>

      {/* Hidden processing canvas holds pixels buffer */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
