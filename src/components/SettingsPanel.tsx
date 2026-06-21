import { ProtocolConfig } from "../types";
import { Sliders, HelpCircle } from "lucide-react";

interface SettingsPanelProps {
  config: ProtocolConfig;
  onChange: (newConfig: ProtocolConfig) => void;
  disabled?: boolean;
}

export function SettingsPanel({ config, onChange, disabled = false }: SettingsPanelProps) {
  const updateConfig = (key: keyof ProtocolConfig, val: any) => {
    onChange({
      ...config,
      [key]: val,
    });
  };

  return (
    <div className="bg-[#0f1218] border border-gray-800 rounded-2xl p-6 shadow-xl w-full text-gray-100">
      <div className="flex items-center gap-2 border-b border-gray-800 pb-3 mb-5">
        <Sliders className="w-5 h-5 text-blue-500" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-white">Protocol Configuration</h3>
      </div>

      <div className="space-y-6">
        {/* Packet Size */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-xs font-semibold text-gray-300 flex items-center gap-1">
              Packet Payload Size
              <span className="group relative cursor-pointer">
                <HelpCircle className="w-3.5 h-3.5 text-gray-500 hover:text-gray-400" />
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-[#050608] border border-gray-800 text-gray-300 text-[10px] leading-normal rounded shadow-xl hidden group-hover:block z-30 pointer-events-none font-normal">
                  Bytes per QR code. Smaller codes are easier for bad cameras to resolve, while larger codes increase throughput.
                </span>
              </span>
            </label>
            <span className="text-xs font-mono font-bold text-blue-500">{config.chunkSize} bytes</span>
          </div>
          <input
            type="range"
            min={100}
            max={800}
            step={50}
            value={config.chunkSize}
            onChange={(e) => updateConfig("chunkSize", parseInt(e.target.value, 10))}
            disabled={disabled}
            className="w-full accent-blue-500 h-1.5 bg-[#050608] rounded-lg cursor-pointer disabled:opacity-50"
          />
          <div className="flex justify-between text-[10px] text-gray-500 font-mono mt-1">
            <span>100 B (Dense)</span>
            <span>400 B (Balanced)</span>
            <span>800 B (High Efficiency)</span>
          </div>
        </div>

        {/* Transmission Tick Rate / Delay */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-xs font-semibold text-gray-300 flex items-center gap-1">
              Frame Display Delay
              <span className="group relative cursor-pointer">
                <HelpCircle className="w-3.5 h-3.5 text-gray-500 hover:text-gray-300" />
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-[#050608] border border-gray-800 text-gray-300 text-[10px] leading-normal rounded shadow-xl hidden group-hover:block z-30 pointer-events-none font-normal">
                  Interval inside milliseconds to show each multi-QR frame. Lower means higher FPS on sender. Make sure receiver webcam can match FPS!
                </span>
              </span>
            </label>
            <span className="text-xs font-mono font-bold text-blue-500">{config.frameDelay} ms ({Math.round(1000 / config.frameDelay)} FPS)</span>
          </div>
          <input
            type="range"
            min={30}
            max={500}
            step={10}
            value={config.frameDelay}
            onChange={(e) => updateConfig("frameDelay", parseInt(e.target.value, 10))}
            disabled={disabled}
            className="w-full accent-blue-500 h-1.5 bg-[#050608] rounded-lg cursor-pointer disabled:opacity-50"
          />
          <div className="flex justify-between text-[10px] text-gray-500 font-mono mt-1">
            <span>30 ms (33 FPS)</span>
            <span>150 ms (6.7 FPS)</span>
            <span>500 ms (2 FPS)</span>
          </div>
        </div>

        {/* Sliding Window Size */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-xs font-semibold text-gray-300 flex items-center gap-1">
              Sliding Window size
              <span className="group relative cursor-pointer">
                <HelpCircle className="w-3.5 h-3.5 text-gray-500 hover:text-gray-350" />
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-[#050608] border border-gray-800 text-gray-300 text-[10px] leading-normal rounded shadow-xl hidden group-hover:block z-30 pointer-events-none font-normal">
                  How many packets are actively repeated concurrently. Prevents the sender from moving too far ahead before receiver has acknowledged previous ones.
                </span>
              </span>
            </label>
            <span className="text-xs font-mono font-bold text-blue-500">{config.windowSize} packets</span>
          </div>
          <input
            type="range"
            min={16}
            max={128}
            step={8}
            value={config.windowSize}
            onChange={(e) => updateConfig("windowSize", parseInt(e.target.value, 10))}
            disabled={disabled}
            className="w-full accent-blue-500 h-1.5 bg-[#050608] rounded-lg cursor-pointer disabled:opacity-50"
          />
          <div className="flex justify-between text-[10px] text-gray-500 font-mono mt-1">
            <span>16 pkts</span>
            <span>64 pkts (Default)</span>
            <span>128 pkts</span>
          </div>
        </div>

        {/* QR Error Correction Level */}
        <div>
          <label className="text-xs font-semibold text-gray-300 block mb-1.5 flex items-center gap-1">
            QR Error Correction Level
            <span className="group relative cursor-pointer">
              <HelpCircle className="w-3.5 h-3.5 text-gray-500 hover:text-gray-300" />
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-[#050608] border border-gray-800 text-gray-300 text-[10px] leading-normal rounded shadow-xl hidden group-hover:block z-30 pointer-events-none font-normal">
                QR error tolerance level. H (High, 30%) and Q (25%) survive higher lens smudge, glare, and resolution degradation; L (Low, 7%) allows smaller code size.
              </span>
            </span>
          </label>
          <div className="grid grid-cols-4 gap-2">
            {(["L", "M", "Q", "H"] as const).map((level) => {
              const labelDesc = {
                L: "7% (Low)",
                M: "15% (Mid)",
                Q: "25% (Quar)",
                H: "30% (High)",
              };
              return (
                <button
                  key={level}
                  type="button"
                  disabled={disabled}
                  onClick={() => updateConfig("errorCorrectionLevel", level)}
                  className={`py-1.5 text-xs font-semibold rounded-lg border font-mono transition-all ${
                    config.errorCorrectionLevel === level
                      ? "bg-blue-600 text-white border-blue-500 ring-2 ring-blue-500/20"
                      : "bg-[#050608] text-gray-300 border-gray-800 hover:bg-gray-900"
                  } disabled:opacity-50`}
                >
                  {level}
                  <span className="block text-[8px] text-gray-400 font-sans mt-0.5 font-normal font-sans">
                    {labelDesc[level]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {disabled && (
        <div className="mt-4 p-2.5 bg-blue-950/20 border border-blue-500/20 text-blue-300 rounded-lg text-center text-[10px] font-mono leading-relaxed uppercase">
          Configuration is locked while transfer is actively running!
        </div>
      )}
    </div>
  );
}
