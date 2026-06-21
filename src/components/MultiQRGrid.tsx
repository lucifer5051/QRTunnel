import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { ProtocolConfig } from "../types";

interface MultiQRGridProps {
  packets: (string | null)[];
  config: ProtocolConfig;
  highlightIndices?: number[]; // indices currently active or refreshed
}

export function MultiQRGrid({ packets, config, highlightIndices = [] }: MultiQRGridProps) {
  return (
    <div className="flex flex-col items-center justify-center bg-[#0a0c10]/80 p-5 rounded-2xl border border-gray-800 max-w-lg w-full mx-auto select-none shadow-2xl">
      {/* 2x2 Grid with bright padding to assist the scanner */}
      <div className="grid grid-cols-2 gap-4 w-full aspect-square bg-white p-4 rounded-xl shadow-inner border border-gray-100">
        {Array.from({ length: 4 }).map((_, idx) => {
          const packetText = packets[idx];
          return (
            <QRCanvasCell
              key={idx}
              index={idx}
              text={packetText}
              errorCorrectionLevel={config.errorCorrectionLevel}
              isHighlighted={highlightIndices.includes(idx)}
            />
          );
        })}
      </div>
      <div className="mt-4 text-center text-[10px] text-gray-400 font-mono flex flex-wrap items-center justify-center gap-x-4 gap-y-1 uppercase font-semibold">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500 block"></span> Top-Left (1)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 block"></span> Top-Right (2)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-indigo-500 block"></span> Bottom-Left (3)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-violet-500 block"></span> Bottom-Right (4)
        </span>
      </div>
    </div>
  );
}

interface QRCanvasCellProps {
  key?: any;
  index: number;
  text: string | null;
  errorCorrectionLevel: "L" | "M" | "Q" | "H";
  isHighlighted: boolean;
}

function QRCanvasCell({ index, text, errorCorrectionLevel, isHighlighted }: QRCanvasCellProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (!text) {
      // Render a subtle placeholder when there is no text
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        const width = canvasRef.current.width;
        const height = canvasRef.current.height;
        ctx.fillStyle = "#fafafa";
        ctx.fillRect(0, 0, width, height);
        
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        ctx.strokeRect(4, 4, width - 8, height - 8);

        // Draw a tiny placeholder circle
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, 8, 0, 2 * Math.PI);
        ctx.fillStyle = "#cbd5e1";
        ctx.fill();

        ctx.font = "bold 12px monospace";
        ctx.fillStyle = "#94a3b8";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`QR ${index + 1} (Empty)`, width / 2, height / 2 + 22);
      }
      return;
    }

    QRCode.toCanvas(
      canvasRef.current,
      text,
      {
        width: 250,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
        errorCorrectionLevel: errorCorrectionLevel,
      },
      (error) => {
        if (error) {
          console.error(`Error rendering QR code cell ${index}:`, error);
        }
      }
    );
  }, [text, errorCorrectionLevel, index]);

  // Visual label accent classes
  const labelColors = [
    "bg-blue-600 text-blue-50 border-blue-400",
    "bg-emerald-600 text-emerald-50 border-emerald-400",
    "bg-indigo-600 text-indigo-50 border-indigo-400",
    "bg-violet-600 text-violet-50 border-violet-400",
  ];

  return (
    <div className="relative group flex flex-col items-center justify-center p-1 bg-slate-50 border border-slate-200 rounded-lg hover:shadow-md transition-shadow">
      {/* Visual quadrant badge tracker */}
      <div className={`absolute top-2 left-2 z-10 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold leading-none border shadow-sm ${labelColors[index]}`}>
        #{index + 1}
      </div>

      <div className="w-full h-full p-1 bg-white rounded flex items-center justify-center max-w-[210px] max-h-[210px]">
        <canvas
          ref={canvasRef}
          className={`w-full aspect-square transition-transform duration-200 ${
            isHighlighted ? "scale-[1.01] ring-2 ring-blue-500 rounded-sm" : ""
          }`}
          width={250}
          height={250}
        />
      </div>
    </div>
  );
}
