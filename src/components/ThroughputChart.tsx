interface ThroughputChartProps {
  history: number[]; // Array of speeds in KB/s
  currentSpeed: number;
  averageSpeed: number;
  progress: number; // 0..100
}

export function ThroughputChart({ history, currentSpeed, averageSpeed, progress }: ThroughputChartProps) {
  // Pad history with zeroes if small, or restrict to max points for continuous horizontal fit
  const MAX_POINTS = 30;
  const dataPoints = history.slice(-MAX_POINTS);
  
  // Clean empty-fill pad
  while (dataPoints.length < MAX_POINTS) {
    dataPoints.unshift(0);
  }

  const maxVal = Math.max(...dataPoints, 50, averageSpeed * 1.5); // auto-scale Y axis but keep a neat baseline minimum (50)
  
  // Calculate SVG layout coordinates
  const width = 500;
  const height = 130;
  const paddingX = 10;
  const paddingY = 15;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;

  // Convert points to X, Y
  const coordinates = dataPoints.map((val, idx) => {
    const x = paddingX + (idx / (MAX_POINTS - 1)) * innerWidth;
    const y = paddingY + innerHeight - (val / maxVal) * innerHeight;
    return { x, y, val };
  });

  // SVG path generation
  const linePath = coordinates.length > 0
    ? coordinates.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ")
    : "";

  // Area path generation for gradient fill
  const areaPath = coordinates.length > 0
    ? `${linePath} L ${coordinates[coordinates.length - 1].x.toFixed(1)} ${(height - paddingY).toFixed(1)} L ${coordinates[0].x.toFixed(1)} ${(height - paddingY).toFixed(1)} Z`
    : "";

  return (
    <div className="bg-[#0f1218] border border-gray-800 rounded-xl p-5 shadow-lg text-gray-100 flex flex-col gap-4">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-[#0a0c10]/80 p-2.5 rounded-lg border border-gray-800">
          <span className="block text-[9px] text-gray-500 font-mono tracking-wider uppercase font-semibold">Speed (Current)</span>
          <span className="text-lg font-bold font-mono text-blue-500">
            {currentSpeed.toFixed(1)} <span className="text-[10px] font-normal text-gray-500 uppercase">KB/s</span>
          </span>
        </div>
        <div className="bg-[#0a0c10]/80 p-2.5 rounded-lg border border-gray-800">
          <span className="block text-[9px] text-gray-500 font-mono tracking-wider uppercase font-semibold">Speed (Average)</span>
          <span className="text-lg font-bold font-mono text-blue-400">
            {averageSpeed.toFixed(1)} <span className="text-[10px] font-normal text-gray-500 uppercase">KB/s</span>
          </span>
        </div>
        <div className="bg-[#0a0c10]/80 p-2.5 rounded-lg border border-gray-800">
          <span className="block text-[9px] text-gray-500 font-mono tracking-wider uppercase font-semibold">Progress</span>
          <span className="text-lg font-bold font-mono text-emerald-500">
            {progress.toFixed(1)}<span className="text-[10px] font-normal text-gray-500">%</span>
          </span>
        </div>
      </div>

      {/* SVG Sparkline Graph */}
      <div className="relative bg-[#050608] rounded-xl p-2 border border-gray-800/30 overflow-hidden">
        {/* Dynamic absolute grid lines for high-quality layout details */}
        <div className="absolute top-1/4 left-0 right-0 h-[1px] bg-gray-800/10 pointer-events-none" />
        <div className="absolute top-2/4 left-0 right-0 h-[1px] bg-gray-800/10 pointer-events-none" />
        <div className="absolute top-3/4 left-0 right-0 h-[1px] bg-gray-800/10 pointer-events-none" />

        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[130px] overflow-visible">
          <defs>
            {/* Smooth blue gradient fill */}
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.00" />
            </linearGradient>
            
            {/* Line glow filter */}
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Guidelines labels */}
          <text x={paddingX + 4} y={paddingY + 8} fill="#4b5563" fontSize="8" fontFamily="monospace">
            MAX: {maxVal.toFixed(0)} KB/s
          </text>
          <text x={paddingX + 4} y={height - paddingY - 4} fill="#4b5563" fontSize="8" fontFamily="monospace">
            0 KB/s
          </text>

          {/* Area Fill */}
          {areaPath && (
            <path d={areaPath} fill="url(#chartGradient)" />
          )}

          {/* Line Path */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#glow)"
            />
          )}

          {/* Data Nodes dots decoration */}
          {coordinates.length > 0 && (
            <circle
              cx={coordinates[coordinates.length - 1].x}
              cy={coordinates[coordinates.length - 1].y}
              r="4"
              fill="#3b82f6"
              stroke="#ffffff"
              strokeWidth="2"
            />
          )}
        </svg>

        <div className="absolute bottom-2 right-3 text-[8px] font-mono text-gray-600 uppercase tracking-widest pointer-events-none">
          Visual Link monitor (Past {MAX_POINTS} seconds)
        </div>
      </div>
    </div>
  );
}
