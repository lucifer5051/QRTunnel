import { useState, useEffect, useRef, useCallback, ChangeEvent, DragEvent } from "react";
import { 
  FileUp, 
  Download, 
  HelpCircle, 
  QrCode, 
  Play, 
  Pause, 
  RotateCcw, 
  ChevronRight, 
  Check, 
  WifiOff, 
  Sliders, 
  Monitor, 
  FileText, 
  RefreshCw, 
  AlertTriangle,
  Award,
  ToggleLeft,
  Settings,
  Flame,
  Info,
  Camera
} from "lucide-react";
import QRCode from "qrcode";

import { 
  TransferRole, 
  TransferStatus, 
  TransferMetadata, 
  TransferStats, 
  ProtocolConfig, 
  Packet 
} from "./types";

import { 
  compressData, 
  decompressData, 
  bytesToBase64, 
  base64ToBytes, 
  crc32, 
  generateTransferId, 
  serializePacket, 
  deserializePacket, 
  serializeAck, 
  deserializeAck, 
  compactRanges,
  parseRanges
} from "./utils/protocol";

import { MultiQRGrid } from "./components/MultiQRGrid";
import { QuadrantScanner } from "./components/QuadrantScanner";
import { ThroughputChart } from "./components/ThroughputChart";
import { SettingsPanel } from "./components/SettingsPanel";

export default function App() {
  // Navigation State
  const [role, setRole] = useState<TransferRole>("none");
  const [showSettings, setShowSettings] = useState(false);
  const [simMode, setSimMode] = useState(false);
  const [simLossRate, setSimLossRate] = useState<number>(10); // 10% packet drop rate default

  // Protocol parameters default config
  const [config, setConfig] = useState<ProtocolConfig>({
    chunkSize: 300,
    frameDelay: 80,
    errorCorrectionLevel: "M",
    windowSize: 32,
  });

  // --- SENDER STATE ---
  const [senderFile, setSenderFile] = useState<File | null>(null);
  const [senderStatus, setSenderStatus] = useState<TransferStatus>("idle");
  const [senderMetadata, setSenderMetadata] = useState<TransferMetadata | null>(null);
  const [senderPackets, setSenderPackets] = useState<string[]>([]); // Serialized OFT packets
  const [senderGridPackets, setSenderGridPackets] = useState<(string | null)[]>([null, null, null, null]);
  const [acknowledgedPackets, setAcknowledgedPackets] = useState<Set<number>>(new Set());
  const [windowStart, setWindowStart] = useState<number>(0);
  const [senderStats, setSenderStats] = useState<TransferStats>({
    bytesTransferred: 0,
    packetsTotal: 0,
    packetsProcessed: 0,
    packetsScanned: 0,
    corruptedPackets: 0,
    duplicatedPackets: 0,
    retransmissionsCount: 0,
    currentSpeed: 0,
    averageSpeed: 0,
    progressPercentage: 0,
    elapsedSeconds: 0,
  });
  const [senderSpeedHistory, setSenderSpeedHistory] = useState<number[]>([]);
  const senderIntervalRef = useRef<any>(null);
  const senderSentBytesTracker = useRef<number>(0);

  // --- RECEIVER STATE ---
  const [receiverStatus, setReceiverStatus] = useState<TransferStatus>("idle");
  const [receiverMetadata, setReceiverMetadata] = useState<TransferMetadata | null>(null);
  const [receivedChunks, setReceivedChunks] = useState<(Uint8Array | null)[]>([]);
  const [lastScannedPacketTime, setLastScannedPacketTime] = useState<number>(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  
  // ACK QR payload
  const [activeAckPayload, setActiveAckPayload] = useState<string | null>(null);
  const [receiverStats, setReceiverStats] = useState<TransferStats>({
    bytesTransferred: 0,
    packetsTotal: 0,
    packetsProcessed: 0,
    packetsScanned: 0,
    corruptedPackets: 0,
    duplicatedPackets: 0,
    retransmissionsCount: 0,
    currentSpeed: 0,
    averageSpeed: 0,
    progressPercentage: 0,
    elapsedSeconds: 0,
  });
  const [receiverSpeedHistory, setReceiverSpeedHistory] = useState<number[]>([]);
  const receiverProcessedBytesTracker = useRef<number>(0);
  const ackCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // --- VIRTUAL SIMULATOR BRIDGE LOOPBACK ---
  useEffect(() => {
    if (!simMode || senderStatus !== "active" || receiverStatus === "completed") return;

    // Fast simulation loop
    const simInterval = setInterval(() => {
      // 1. Forward Channel Feed (Sender -> Receiver)
      senderGridPackets.forEach((pStr, idx) => {
        if (!pStr) return;
        
        // Apply synthetic drop rate
        const dropRoll = Math.random() * 100;
        if (dropRoll < simLossRate) {
          // Drops/corrupts packet
          if (Math.random() < 0.2) {
            // 20% of dropped packets are corrupted (invalid checksum)
            const parts = pStr.split("|");
            if (parts.length >= 5) {
              parts[4] = "ffffffff"; // Corrupted CRC
              const corruptedStr = parts.join("|");
              handleReceivePacket(corruptedStr, idx);
            }
          }
          return; // Dropped completely
        }
        
        // Perfect Delivery
        handleReceivePacket(pStr, idx);
      });

      // 2. Reverse Channel Feed (Receiver -> Sender)
      if (activeAckPayload) {
        // Reverse packet feedback
        const ackDropRoll = Math.random() * 100;
        if (ackDropRoll < simLossRate) return; // ACK dropped
        
        handleSenderScannedAck(activeAckPayload);
      }
    }, config.frameDelay);

    return () => clearInterval(simInterval);
  }, [simMode, senderStatus, receiverStatus, senderGridPackets, activeAckPayload, simLossRate, config.frameDelay]);

  // --- CLOCK MONITOR FOR SENDER SPEED STATS ---
  useEffect(() => {
    if (senderStatus !== "active") return;

    const timer = setInterval(() => {
      setSenderStats((prev) => {
        const nextSec = prev.elapsedSeconds + 1;
        
        // Read byte deltas
        const currentBytes = senderSentBytesTracker.current;
        const currentSpeedKB = currentBytes / 1024; // Bytes dispatched this second
        senderSentBytesTracker.current = 0; // Reset instantaneous second tracker

        const totalBytesCumulative = prev.bytesTransferred + currentBytes;
        const averageSpeedKB = nextSec > 0 ? (totalBytesCumulative / nextSec) / 1024 : 0;

        setSenderSpeedHistory((h) => [...h, currentSpeedKB]);

        // Calculate progress percentage
        const totalP = senderMetadata ? senderMetadata.totalPackets + 1 : 0;
        const ackedCount = acknowledgedPackets.size;
        const progress = totalP > 0 ? (ackedCount / totalP) * 100 : 0;

        return {
          ...prev,
          bytesTransferred: totalBytesCumulative,
          currentSpeed: currentSpeedKB,
          averageSpeed: averageSpeedKB,
          elapsedSeconds: nextSec,
          progressPercentage: progress,
          packetsProcessed: ackedCount,
        };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [senderStatus, acknowledgedPackets, senderMetadata]);

  // --- CLOCK MONITOR FOR RECEIVER SPEED STATS ---
  useEffect(() => {
    if (receiverStatus !== "active") return;

    const timer = setInterval(() => {
      setReceiverStats((prev) => {
        const nextSec = prev.elapsedSeconds + 1;

        const currentBytes = receiverProcessedBytesTracker.current;
        const currentSpeedKB = currentBytes / 1024;
        receiverProcessedBytesTracker.current = 0; // reset

        const totalBytesCumulative = prev.bytesTransferred + currentBytes;
        const averageSpeedKB = nextSec > 0 ? (totalBytesCumulative / nextSec) / 1024 : 0;

        setReceiverSpeedHistory((h) => [...h, currentSpeedKB]);

        // Progressive bar calculation
        const totalP = receiverMetadata ? receiverMetadata.totalPackets + 1 : 0;
        const processedCount = receivedChunks.filter((c) => c !== null).length;
        const progress = totalP > 0 ? (processedCount / totalP) * 100 : 0;

        return {
          ...prev,
          bytesTransferred: totalBytesCumulative,
          currentSpeed: currentSpeedKB,
          averageSpeed: averageSpeedKB,
          elapsedSeconds: nextSec,
          progressPercentage: progress,
          packetsProcessed: processedCount,
        };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [receiverStatus, receivedChunks, receiverMetadata]);


  // --- SENDER INITIALIZATION ---
  const initializeForwardTransfer = async () => {
    if (!senderFile) return;

    try {
      setSenderStatus("preparing");
      const reader = new FileReader();
      
      reader.onload = async () => {
        try {
          const rawBytes = new Uint8Array(reader.result as ArrayBuffer);
          
          // Compressing File
          const compressed = await compressData(rawBytes);
          const totalChunks = Math.ceil(compressed.length / config.chunkSize);
          const transferId = generateTransferId();

          // Create indexable payload packet list
          // Packet 0 is metadata
          const metaPayload = `META|${senderFile.name}|${rawBytes.length}|${compressed.length}|${totalChunks}`;
          const encoder = new TextEncoder();
          const metaBytes = encoder.encode(metaPayload);
          
          const metaBase64 = bytesToBase64(metaBytes);
          const metaCrc = crc32(metaBytes);

          const packetsList: string[] = [];
          
          // Insert metadata slot as index #0
          packetsList.push(
            serializePacket(transferId, 0, totalChunks, metaCrc, metaBase64)
          );

          // Divide compressed file bytes into packet list index #1..N
          for (let i = 0; i < totalChunks; i++) {
            const startOffset = i * config.chunkSize;
            const endOffset = Math.min((i + 1) * config.chunkSize, compressed.length);
            const chunkSlice = compressed.subarray(startOffset, endOffset);

            const chunkBase64 = bytesToBase64(chunkSlice);
            const chunkCrc = crc32(chunkSlice);

            // index counts 1-based offset for chunk payload
            packetsList.push(
              serializePacket(transferId, i + 1, totalChunks, chunkCrc, chunkBase64)
            );
          }

          setSenderMetadata({
            id: transferId,
            filename: senderFile.name,
            originalSize: rawBytes.length,
            compressedSize: compressed.length,
            totalPackets: totalChunks,
            chunkSize: config.chunkSize,
          });

          setSenderPackets(packetsList);
          setAcknowledgedPackets(new Set());
          setWindowStart(0);
          setSenderSpeedHistory([]);
          setSenderStats({
            bytesTransferred: 0,
            packetsTotal: totalChunks + 1, // data chunks + metadata pack
            packetsProcessed: 0,
            packetsScanned: 0,
            corruptedPackets: 0,
            duplicatedPackets: 0,
            retransmissionsCount: 0,
            currentSpeed: 0,
            averageSpeed: 0,
            progressPercentage: 0,
            elapsedSeconds: 0,
          });

          setSenderStatus("active");
          senderSentBytesTracker.current = 0;
        } catch (err: any) {
          alert(`Compression failed: ${err.message}`);
          setSenderStatus("idle");
        }
      };

      reader.readAsArrayBuffer(senderFile);
    } catch (e) {
      setSenderStatus("idle");
    }
  };


  // --- SENDER TRANSMISSION FRAME RENDER TICK TICK ---
  // Every tick, we pick 4 packets from current Sliding Window.
  // We feed them into our 2x2 grid cell array.
  const updateGridPackets = useCallback(() => {
    if (!senderMetadata || senderPackets.length === 0) return;

    const totalP = senderPackets.length; // totalSegments + 1 (including metadata)
    const windowEnd = Math.min(windowStart + config.windowSize, totalP);

    // Filter packets in current window that are not yet acknowledged
    const pendingPackets: number[] = [];
    for (let i = windowStart; i < windowEnd; i++) {
      if (!acknowledgedPackets.has(i)) {
        pendingPackets.push(i);
      }
    }

    const gridCells: (string | null)[] = [null, null, null, null];
    
    // Fill the 4 grid slots with pending packets, repeating cyclically if we have fewer than 4 remaining,
    // which increases redundant scanning hits on receiver camera!
    if (pendingPackets.length > 0) {
      for (let cellIdx = 0; cellIdx < 4; cellIdx++) {
        const packetIdx = pendingPackets[cellIdx % pendingPackets.length];
        gridCells[cellIdx] = senderPackets[packetIdx];
        
        // Track byte dispatched telemetry
        const rawPacketStr = senderPackets[packetIdx];
        senderSentBytesTracker.current += rawPacketStr.length;
      }
    } else {
      // If no packets within active window are pending, but we are not fully acknowledged,
      // repeat the window block anyway to trigger feedback synchronization.
      for (let cellIdx = 0; cellIdx < 4; cellIdx++) {
        const fallbackIdx = (windowStart + cellIdx) % totalP;
        gridCells[cellIdx] = senderPackets[fallbackIdx];
      }
    }

    setSenderGridPackets(gridCells);
  }, [senderMetadata, senderPackets, windowStart, acknowledgedPackets, config.windowSize]);


  // Effect tracking active tick loop
  useEffect(() => {
    if (senderStatus !== "active" || role !== "send") {
      if (senderIntervalRef.current) {
        clearInterval(senderIntervalRef.current);
        senderIntervalRef.current = null;
      }
      return;
    }

    // Direct loop tick trigger
    updateGridPackets();

    senderIntervalRef.current = setInterval(() => {
      updateGridPackets();
    }, config.frameDelay);

    return () => {
      if (senderIntervalRef.current) {
        clearInterval(senderIntervalRef.current);
        senderIntervalRef.current = null;
      }
    };
  }, [senderStatus, role, config.frameDelay, updateGridPackets]);


  // --- SENDER DECODES REVERSE CHANNEL ACK ---
  const handleSenderScannedAck = useCallback((ackString: string) => {
    if (senderStatus !== "active") return;

    const ack = deserializeAck(ackString);
    if (!ack || !senderMetadata || ack.transferId !== senderMetadata.id) return;

    setSenderStats((prev) => ({
      ...prev,
      packetsScanned: prev.packetsScanned + 1,
    }));

    if (ack.isDone) {
      // Receiver fully loaded everything and triggered DONE sign!
      setAcknowledgedPackets((prev) => {
        const all = new Set(prev);
        for (let i = 0; i <= senderMetadata.totalPackets; i++) {
          all.add(i);
        }
        return all;
      });
      setSenderStatus("completed");
      return;
    }

    // Process TCP sliding acknowledgment update
    setAcknowledgedPackets((prev) => {
      const next = new Set(prev);
      
      // 1. Mark continuous elements
      for (let i = 0; i <= ack.continuousPkt; i++) {
        next.add(i);
      }

      // 2. Anything inside sliding window that is NOT labeled missing is acknowledged safely
      const totalP = senderMetadata.totalPackets + 1;
      const currentWindowLimit = Math.min(windowStart + config.windowSize, totalP);
      const missingIndexSet = new Set(ack.missingPackets);

      for (let i = ack.continuousPkt + 1; i < currentWindowLimit; i++) {
        if (!missingIndexSet.has(i)) {
          // If not marked missing inside range feedback, it was received successfully!
          next.add(i);
        }
      }

      // 3. Find next sliding window floor
      let newStart = windowStart;
      while (newStart < totalP && next.has(newStart)) {
        newStart++;
      }
      
      if (newStart !== windowStart) {
        setWindowStart(newStart);
      }

      return next;
    });
  }, [senderStatus, senderMetadata, windowStart, config.windowSize]);


  // --- RECEIVER RAW PACKET CONSUMED HANDLER ---
  const handleReceivePacket = useCallback((packetStr: string, quadrantIndex: number) => {
    const parsed = deserializePacket(packetStr);
    if (!parsed) return;

    setLastScannedPacketTime(Date.now());

    // 1. If we are completely idle or viewing different transfer ID, trigger fresh initialization
    if (receiverStatus === "idle" || (receiverMetadata && receiverMetadata.id !== parsed.transferId)) {
      setReceiverStatus("active");
      const totalAllocated = parsed.totalPackets + 1; // segments + meta pocket
      
      const emptyBuffer = new Array(totalAllocated).fill(null);
      setReceivedChunks(emptyBuffer);
      setReceiverSpeedHistory([]);
      setReceiverMetadata({
        id: parsed.transferId,
        filename: "Receiving File...", // Will extract when Meta packet index 0 delivers
        originalSize: 0,
        compressedSize: 0,
        totalPackets: parsed.totalPackets,
        chunkSize: config.chunkSize, // tentative, parsed dynamically
      });

      setReceiverStats({
        bytesTransferred: 0,
        packetsTotal: totalAllocated,
        packetsProcessed: 0,
        packetsScanned: 0,
        corruptedPackets: 0,
        duplicatedPackets: 0,
        retransmissionsCount: 0,
        currentSpeed: 0,
        averageSpeed: 0,
        progressPercentage: 0,
        elapsedSeconds: 0,
      });

      receiverProcessedBytesTracker.current = 0;
    }

    setReceiverStats((prev) => ({
      ...prev,
      packetsScanned: prev.packetsScanned + 1,
    }));

    // Update active arrays
    setReceivedChunks((prevBuffer) => {
      // Guard bounds
      if (parsed.index >= prevBuffer.length) {
        // Grow buffer dynamically if segment counts differed due to meta lag
        const grew = [...prevBuffer];
        while (grew.length <= parsed.index) grew.push(null);
        return grew;
      }

      // Duplicate Check
      if (prevBuffer[parsed.index] !== null) {
        setReceiverStats((prev) => ({
          ...prev,
          duplicatedPackets: prev.duplicatedPackets + 1,
        }));
        return prevBuffer;
      }

      // Checksum validation
      const binaryBytes = base64ToBytes(parsed.payloadBase64);
      const computedCrc = crc32(binaryBytes);

      if (computedCrc !== parsed.checksum) {
        setReceiverStats((prev) => ({
          ...prev,
          corruptedPackets: prev.corruptedPackets + 1,
        }));
        console.warn(`[CRC Mismatch] Corrupt packet index #${parsed.index}`);
        return prevBuffer;
      }

      // Write block data with 100% integrity guarantee
      const updated = [...prevBuffer];
      updated[parsed.index] = binaryBytes;

      // Track exact data throughput metrics
      receiverProcessedBytesTracker.current += packetStr.length;

      // If this is Packet index 0, decode file meta data
      if (parsed.index === 0) {
        try {
          const stringified = new TextDecoder().decode(binaryBytes);
          const parts = stringified.split("|");
          if (parts[0] === "META") {
            const fname = parts[1];
            const origSize = parseInt(parts[2], 10);
            const compSize = parseInt(parts[3], 10);
            const segments = parseInt(parts[4], 10);

            setReceiverMetadata((prev) => {
              if (!prev) return null;
              return {
                ...prev,
                filename: fname,
                originalSize: origSize,
                compressedSize: compSize,
                totalPackets: segments,
              };
            });
            
            // Adjust buffer size representation if needed
            if (updated.length !== segments + 1) {
              const rescaled = new Array(segments + 1).fill(null);
              updated.forEach((unit, idx) => {
                if (idx < rescaled.length) rescaled[idx] = unit;
              });
              return rescaled;
            }
          }
        } catch (e) {
          console.error("Failed to parse metadata", e);
        }
      }

      // Evaluate complete delivery success
      const fullyAssembled = updated.every((segment) => segment !== null);
      if (fullyAssembled && updated.length > 0) {
         assembleReceiverFileAndFinalize(updated);
      }

      return updated;
    });

  }, [receiverStatus, receiverMetadata, config.chunkSize]);


  // --- RECONSTRUCT ORIGINAL FILE AND PROMPT USER DOWNLOAD ---
  const assembleReceiverFileAndFinalize = async (buffer: (Uint8Array | null)[]) => {
    setReceiverStatus("preparing"); // show finalizing status
    
    try {
      // 1. Gather segments indices 1..N
      const segments: Uint8Array[] = [];
      for (let i = 1; i < buffer.length; i++) {
        if (buffer[i]) segments.push(buffer[i]!);
      }

      // Concat all compressed segments
      let totalCompLength = segments.reduce((sum, s) => sum + s.length, 0);
      const compressedConcat = new Uint8Array(totalCompLength);
      let byteOffset = 0;
      for (const segment of segments) {
        compressedConcat.set(segment, byteOffset);
        byteOffset += segment.length;
      }

      // Decompress
      const rawOriginalBytes = await decompressData(compressedConcat);

      // Create Blob link
      const blob = new Blob([rawOriginalBytes], { type: "application/octet-stream" });
      const dlLink = URL.createObjectURL(blob);
      setDownloadUrl(dlLink);
      setReceiverStatus("completed");

      // Set speed metrics at 100% finished
      setReceiverStats((prev) => ({
        ...prev,
        progressPercentage: 100,
      }));

      // Trigger standard browser download instantly
      const tag = document.createElement("a");
      tag.href = dlLink;
      tag.download = receiverMetadata?.filename || "recomposed_file";
      document.body.appendChild(tag);
      tag.click();
      document.body.removeChild(tag);
    } catch (err: any) {
      alert(`Decompression/De-packetization failed! Error details: ${err.message}`);
      setReceiverStatus("error");
    }
  };


  // --- COMPILE & BROADCAST REVERSE CHANNEL ACK FEEDBACK ---
  // Calculates continuous packets and missing segments, compiles ACK string
  const compileAndRenderReceiverAck = useCallback(() => {
    if (!receiverMetadata || receivedChunks.length === 0) return;

    const totalP = receivedChunks.length; // totalSegments + 1 (includes metadata)
    
    // Find continuous packet base index (0..C) where block is non-null
    let continuousP = -1;
    while (continuousP + 1 < totalP && receivedChunks[continuousP + 1] !== null) {
      continuousP++;
    }

    // Find all missing packet slots in the sliding window range
    const missingPackets: number[] = [];
    const maxWindowScan = Math.min(continuousP + 1 + config.windowSize, totalP);
    
    for (let i = continuousP + 1; i < maxWindowScan; i++) {
      if (receivedChunks[i] === null) {
        missingPackets.push(i);
      }
    }

    const isFullyComplete = continuousP === totalP - 1;
    const ackStr = serializeAck(receiverMetadata.id, continuousP, compactRanges(missingPackets), isFullyComplete);
    
    setActiveAckPayload(ackStr);

    // Render local ACK QR to canvas for physical optical connection
    if (ackCanvasRef.current) {
      QRCode.toCanvas(
        ackCanvasRef.current,
        ackStr,
        {
          width: 250,
          margin: 1.5,
          color: {
            dark: "#0a0f1d", // elegant night colors
            light: "#ffffff",
          },
          errorCorrectionLevel: "L", // ACK fits in low EC, making it simpler/faster to scan
        },
        (error) => {
          if (error) console.error("Error drawing ACK barcode", error);
        }
      );
    }
  }, [receiverMetadata, receivedChunks, config.windowSize]);

  // Sync ACK barcode frame changes
  useEffect(() => {
    if (receiverStatus === "active" || receiverStatus === "completed") {
      compileAndRenderReceiverAck();
    }
  }, [receivedChunks, receiverStatus, compileAndRenderReceiverAck]);


  // Helper reset functions
  const resetSender = () => {
    setSenderStatus("idle");
    setSenderMetadata(null);
    setSenderPackets([]);
    setSenderGridPackets([null, null, null, null]);
    setAcknowledgedPackets(new Set());
    setWindowStart(0);
    setSenderSpeedHistory([]);
    setSenderFile(null);
  };

  const resetReceiver = () => {
    setReceiverStatus("idle");
    setReceiverMetadata(null);
    setReceivedChunks([]);
    setDownloadUrl(null);
    setActiveAckPayload(null);
    setReceiverSpeedHistory([]);
  };

  // Drag and drop helper settings
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setSenderFile(file);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSenderFile(file);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0c10] font-sans text-gray-200 antialiased selection:bg-blue-600 selection:text-white pb-12 relative overflow-x-hidden">
      {/* Background Radial and grid guidelines overlay */}
      <div className="absolute inset-0 bg-[#050608] bg-optic-grid opacity-10 pointer-events-none z-0" />
      <div className="absolute top-0 left-0 right-0 h-[500px] bg-gradient-to-b from-blue-950/10 to-transparent pointer-events-none z-0" />

      {/* Main Header navigation bar */}
      <nav className="relative z-10 border-b border-gray-800 bg-[#0f1218] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-bold text-white shadow-lg shadow-blue-600/20">
            LT
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white uppercase sm:text-base flex items-center gap-2">
              Lumina Optical Transport <span className="text-blue-500 font-mono text-xs font-normal">v1.1.2</span>
            </h1>
            <p className="text-[10px] text-gray-400 font-mono tracking-wider uppercase">
              MULTI-QR OPTICAL PACKET LAYER (TCP/LP / DIRECT-LIGHT)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Connection Status indicator */}
          <div className="hidden md:flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            <span className="text-[10px] font-mono uppercase text-gray-400 tracking-wider">Link Established</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Virtual loopback mode switch */}
            <div className="hidden sm:flex items-center gap-2 bg-[#050608] px-3 py-1.5 rounded-lg border border-gray-850">
              <span className="text-[10px] font-mono text-gray-400">Electronic Loopback Sim:</span>
              <button
                onClick={() => {
                  setSimMode(!simMode);
                  if (role === "none") setRole("send"); // pre-nav to send/sim layout
                  resetSender();
                  resetReceiver();
                }}
                className={`text-xs px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                  simMode 
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/10" 
                    : "bg-gray-800 text-gray-400 hover:text-gray-200"
                }`}
              >
                {simMode ? "ACTIVE" : "DISABLED"}
              </button>
            </div>

            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 bg-gray-900 hover:bg-[#0f1218] border border-gray-800 text-gray-400 hover:text-gray-200 rounded-lg transition-colors cursor-pointer"
              title="Protocol Tuner"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Container viewport */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 mt-8 sm:px-6">
        
        {/* TOP LEVEL PROTOCOL INTRO & TUNER CARD */}
        {showSettings && (
          <div className="mb-6 animate-fadeIn">
            <SettingsPanel config={config} onChange={setConfig} disabled={senderStatus === "active" || receiverStatus === "active"} />
          </div>
        )}

        {/* ROLE CHOOSER HUB */}
        {role === "none" && (
          <div className="max-w-4xl mx-auto mt-12 text-center animate-fadeIn">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#0f1218] border border-gray-800 rounded-full text-xs text-blue-400 font-mono mb-6 shadow-sm">
              <Flame className="w-3.5 h-3.5 text-blue-500 animate-pulse" /> High-speed zero-network physical packet streams
            </div>
            <h2 className="text-3xl font-extrabold text-white tracking-tight sm:text-4xl">
              Establish Direct Visual Communication
            </h2>
            <p className="mt-3 text-sm text-gray-400 max-w-xl mx-auto leading-relaxed">
              Transport records cleanly between laptops completely air-gapped without Wi-Fi, BT, or wires, utilizing a robust high-speed continuous multi-QR light transceiver loop.
            </p>

            {/* Quick selector options */}
            <div className="grid md:grid-cols-2 gap-6 mt-10">
              {/* SENDER SELECT CARD */}
              <button
                onClick={() => {
                  setRole("send");
                  setSimMode(false);
                }}
                className="group text-left bg-[#0f1218] hover:bg-[#131720] border border-gray-800 hover:border-blue-500/50 p-8 rounded-2xl transition-all duration-300 hover:shadow-2xl hover:scale-[1.01] flex flex-col justify-between cursor-pointer"
              >
                <div>
                  <div className="bg-blue-500/10 text-blue-400 border border-blue-500/20 w-12 h-12 rounded-xl flex items-center justify-center mb-6">
                    <QrCode className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">
                    Sender Gateway
                  </h3>
                  <p className="text-xs text-gray-400 mt-2.5 leading-relaxed font-normal">
                    Prepare computer files, compress them transparently, project a 2x2 multi-QR payload matrix, and track physical acknowledgement sweeps via the webcam.
                  </p>
                </div>
                <div className="mt-8 flex items-center text-xs text-gray-500 font-mono font-semibold group-hover:text-gray-300">
                  Transmitter console <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
                </div>
              </button>

              {/* RECEIVER SELECT CARD */}
              <button
                onClick={() => {
                  setRole("receive");
                  setSimMode(false);
                }}
                className="group text-left bg-[#0f1218] hover:bg-[#131720] border border-gray-800 hover:border-emerald-500/50 p-8 rounded-2xl transition-all duration-300 hover:shadow-2xl hover:scale-[1.01] flex flex-col justify-between cursor-pointer"
              >
                <div>
                  <div className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 w-12 h-12 rounded-xl flex items-center justify-center mb-6">
                    <Download className="w-6 h-6 animate-bounce" />
                  </div>
                  <h3 className="text-lg font-bold text-white group-hover:text-emerald-400 transition-colors">
                    Receiver Gateway
                  </h3>
                  <p className="text-xs text-gray-400 mt-2.5 leading-relaxed font-normal">
                    Listen over laptop webcam, crop quadrants in parallel to scan multi-QR packages, and instantly reflect reverse-loop acknowledgements to correct corrupted blocks.
                  </p>
                </div>
                <div className="mt-8 flex items-center text-xs text-gray-500 font-mono font-semibold group-hover:text-gray-300">
                  Receiver console <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
                </div>
              </button>
            </div>

            {/* Virtual playground button */}
            <div className="mt-10 pt-8 border-t border-gray-800/60">
              <button
                onClick={() => {
                  setRole("send"); // start by mounting send states side by side
                  setSimMode(true);
                  setSimLossRate(12); // pre config loss rate
                }}
                className="text-xs font-mono bg-[#0f1218] hover:bg-[#131720] px-5 py-3 rounded-xl border border-gray-800 transition-all text-gray-300 hover:text-blue-400 flex items-center gap-2 mx-auto cursor-pointer shadow-sm hover:border-blue-500/30"
              >
                <Monitor className="w-4 h-4 text-blue-500" /> Keep on single computer: Try the Virtual Loopback Protocol Simulator!
              </button>
            </div>
          </div>
        )}

        {/* ACTIVE MULTI-ROLE LAYOUT VIEWS (SENDER & RECEIVER AND SIM BRIDGE) */}
        {role !== "none" && (
          <div className="space-y-6">
            
            {/* Nav Back Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-800 pb-5">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    resetSender();
                    resetReceiver();
                    setRole("none");
                    setSimMode(false);
                  }}
                  className="px-3.5 py-1.5 bg-gray-900 hover:bg-[#0f1218] border border-gray-800 rounded-lg text-xs font-mono text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
                >
                  &larr; Exit Console
                </button>
                <div className="h-4 w-[1px] bg-gray-800" />
                <span className="text-xs font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-0.5 rounded-md uppercase font-bold">
                  {simMode ? "Playground Simulation Console" : (role === "send" ? "Transmitter Mode" : "Receiver Mode")}
                </span>
              </div>

              {simMode && (
                <div className="flex items-center gap-4 bg-[#0f1218] px-4 py-2 rounded-xl border border-gray-800">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-mono uppercase text-gray-500">Synthetic Packet Loss Rate</span>
                    <span className="text-xs font-mono font-bold text-blue-400">{simLossRate}% drop</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    step="2"
                    value={simLossRate}
                    onChange={(e) => setSimLossRate(parseInt(e.target.value, 10))}
                    className="accent-blue-500 h-1 bg-gray-800 rounded min-w-[120px] cursor-pointer"
                  />
                </div>
              )}
            </div>

            {/* SPLIT WINDOWS IF IN SIMULATION MODE OR ACTIVE SINGLE SENDER/RECEIVER */}
            <div className={`grid ${simMode ? "lg:grid-cols-2" : "grid-cols-1"} gap-8`}>
              
              {/* === TRANSMITTER CONSOLE SECTION (Rendered if role is send OR in simMode) === */}
              {(role === "send" || simMode) && (
                <div className="space-y-6 bg-[#0f1218] p-6 rounded-2xl border border-gray-800">
                  <div className="flex justify-between items-center bg-[#0a0c10]/80 p-3 rounded-xl border border-gray-800">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                      <h4 className="font-bold text-sm tracking-tight text-white font-mono uppercase">I. Transmitter Panel</h4>
                    </div>
                    {senderStatus === "active" && (
                      <span className="text-[10px] font-mono text-blue-400 bg-blue-500/10 px-2.5 py-0.5 rounded leading-none">
                        Transmitting...
                      </span>
                    )}
                  </div>

                  {/* SENDER CHOOSE FILE STAGE */}
                  {senderStatus === "idle" && (
                    <div className="space-y-4">
                      <div
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        className="border border-dashed border-gray-800 hover:border-blue-500 rounded-xl p-8 bg-[#0a0c10]/30 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 group relative"
                      >
                        <input
                          type="file"
                          id="file-element"
                          onChange={handleFileChange}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                        <div className="bg-blue-600/10 text-blue-400 border border-blue-500/20 p-3.5 rounded-xl group-hover:scale-105 transition-transform">
                          <FileUp className="w-6 h-6 animate-bounce" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-white">Select File to Transmit</p>
                          <p className="text-[10px] text-gray-500 font-mono mt-1">
                            Drag & drop or click to choose up to 15MB file
                          </p>
                        </div>
                      </div>

                      {senderFile && (
                        <div className="p-3 bg-[#0a0c10]/80 rounded-xl border border-gray-800 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <FileText className="w-8 h-8 text-blue-400 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-white truncate font-mono">{senderFile.name}</p>
                              <p className="text-[10px] text-gray-400 font-mono">
                                {(senderFile.size / 1024).toFixed(1)} KB &bull; Type: {senderFile.type || "binary"}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={initializeForwardTransfer}
                            disabled={senderStatus === "preparing"}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 font-bold font-mono text-xs text-white rounded-lg transition-colors shadow-lg shadow-blue-600/10 cursor-pointer flex items-center gap-1.5 shrink-0"
                          >
                            {senderStatus === "preparing" ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" /> Initialize
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* SENDER TRANSMISSION ACTIVE STATE */}
                  {senderStatus !== "idle" && senderMetadata && (
                    <div className="space-y-6">
                      
                      {/* Grid Display */}
                      <div className="relative">
                        <MultiQRGrid
                          packets={senderGridPackets}
                          config={config}
                          highlightIndices={senderGridPackets.map((p, i) => p ? i : -1).filter(idx => idx !== -1)}
                        />
                      </div>

                      {/* Sliding Window Progress Bar */}
                      <div className="p-4 bg-[#0a0c10]/60 rounded-xl border border-gray-800">
                        <div className="flex justify-between items-center text-xs font-mono mb-2">
                          <span className="text-gray-400 text-[10px] uppercase">Sliding Window Sequence Loop</span>
                          <span className="text-blue-400 font-semibold">
                            [{windowStart} - {Math.min(windowStart + config.windowSize, senderMetadata.totalPackets)}] / {senderMetadata.totalPackets}
                          </span>
                        </div>
                        
                        {/* Interactive Tiny Block Buffer cells */}
                        <div className="flex flex-wrap gap-1 max-h-[85px] overflow-y-auto p-1.5 bg-[#050608] border border-gray-800 rounded">
                          {Array.from({ length: senderMetadata.totalPackets + 1 }).map((_, idx) => {
                            let cellBg = "bg-gray-800"; // not in window
                            const inWindow = idx >= windowStart && idx < windowStart + config.windowSize;
                            const isAcked = acknowledgedPackets.has(idx);

                            if (isAcked) {
                              cellBg = "bg-emerald-500 shadow-sm shadow-emerald-500/20";
                            } else if (inWindow) {
                              cellBg = "bg-blue-500 animate-pulse";
                            }

                            return (
                              <span
                                key={idx}
                                className={`w-2.5 h-2.5 rounded-[2px] transition-colors ${cellBg}`}
                                title={`Pkt ${idx}: ${isAcked ? "ACKed" : inWindow ? "Pending Send" : "Idle"}`}
                              />
                            );
                          })}
                        </div>
                      </div>

                      {/* Live Speed Graph */}
                      <ThroughputChart
                        history={senderSpeedHistory}
                        currentSpeed={senderStats.currentSpeed}
                        averageSpeed={senderStats.averageSpeed}
                        progress={senderStats.progressPercentage}
                      />

                      {/* Actions Panel */}
                      <div className="flex gap-3 justify-end">
                        <button
                          onClick={resetSender}
                          className="px-3.5 py-1.5 bg-gray-900 border border-gray-805 hover:bg-[#0f1218] rounded-lg text-xs font-mono text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
                        >
                          Cancel / Reset
                        </button>
                      </div>

                      {/* Optical Reverse feedback input (Sender Webcam scanning Receiver ACKs) */}
                      {!simMode && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-2 px-1">
                            <Info className="w-3.5 h-3.5 text-gray-500" />
                            <span className="text-[10px] font-mono text-gray-500 uppercase">
                              Sender Reverse Webcam Link (Aim at receiver ACK QR)
                            </span>
                          </div>
                          <QuadrantScanner
                            isActive={senderStatus === "active"}
                            onQrScanned={handleSenderScannedAck}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* === RECEIVER CONSOLE SECTION (Rendered if role is receive OR in simMode) === */}
              {(role === "receive" || simMode) && (
                <div className="space-y-6 bg-[#0f1218] p-6 rounded-2xl border border-gray-800">
                  <div className="flex justify-between items-center bg-[#0a0c10]/80 p-3 rounded-xl border border-gray-800">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <h4 className="font-bold text-sm tracking-tight text-white font-mono uppercase">II. Receiver Panel</h4>
                    </div>
                    {receiverStatus === "active" && (
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded leading-none">
                        Receiving...
                      </span>
                    )}
                  </div>

                  {/* IDLE OR INITIAL SCAN FOR WEB CAMERA */}
                  {receiverStatus === "idle" && !simMode && (
                    <div className="space-y-4">
                      <div className="text-center p-6 bg-[#0a0c10]/30 border border-gray-800 rounded-xl flex flex-col items-center justify-center gap-3">
                        <Camera className="w-8 h-8 text-gray-500 animate-pulse" />
                        <div>
                          <p className="text-xs font-sans text-gray-300 font-semibold">Ready to align device webcam</p>
                          <p className="text-[10px] text-gray-500 font-mono mt-1.5 uppercase">
                            Webcam will initiate automatically below when ready
                          </p>
                        </div>
                      </div>

                      <QuadrantScanner
                        isActive={true}
                        onQrScanned={(data) => handleReceivePacket(data, 4)}
                      />
                    </div>
                  )}

                  {/* SINGLE COMPUTER LOOPBACK SIM INACTIVE HOLDER */}
                  {simMode && receiverStatus === "idle" && (
                    <div className="p-8 border border-dashed border-gray-800 bg-[#0a0c10]/30 rounded-xl text-center text-gray-400 font-mono text-xs flex flex-col items-center gap-2">
                      <Monitor className="w-8 h-8 text-blue-500 opacity-80" />
                      <span className="font-semibold text-white">Single-computer simulation link waiting...</span>
                      <span className="text-[10px] text-gray-500">Select any file on left Transmitter card and hit "Initialize" to fire packet loop!</span>
                    </div>
                  )}

                  {/* ACTIVE RECEIVER COMPILING STAGE */}
                  {receiverStatus !== "idle" && receiverMetadata && (
                    <div className="space-y-6">
                      
                      {/* Active File Banner */}
                      <div className="p-3 bg-[#0a0c10]/80 border border-gray-800 rounded-xl flex items-center justify-between gap-3 font-mono text-xs">
                        <div className="min-w-0">
                          <span className="text-[9px] text-gray-500 uppercase block tracking-wider font-semibold">File Metadata Received</span>
                          <span className="font-bold text-white truncate text-[11px] block">{receiverMetadata.filename}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-[9px] text-gray-500 uppercase block tracking-wider font-semibold">Decompressed Size</span>
                          <span className="text-emerald-400 font-semibold">
                            {receiverMetadata.originalSize ? `${(receiverMetadata.originalSize / 1024).toFixed(1)} KB` : "Buffering Meta..."}
                          </span>
                        </div>
                      </div>

                      {/* Assembly bento grid blocks showing receipt progress */}
                      <div className="p-4 bg-[#0a0c10]/60 rounded-xl border border-gray-800">
                        <div className="flex justify-between items-center text-xs font-mono mb-2">
                          <span className="text-gray-400 text-[10px] uppercase block">Reconstitution Block Grid</span>
                          <span className="text-emerald-400 font-semibold">
                            {receivedChunks.filter((c) => c !== null).length} / {receivedChunks.length} Received
                          </span>
                        </div>
                        
                        {/* Interactive bento blocks */}
                        <div className="flex flex-wrap gap-1 max-h-[85px] overflow-y-auto p-1.5 bg-[#050608] border border-gray-800 rounded">
                          {receivedChunks.map((chunk, idx) => (
                            <span
                              key={idx}
                              className={`w-2.5 h-2.5 rounded-[2px] transition-colors ${
                                chunk !== null 
                                  ? "bg-emerald-500 shadow-sm shadow-emerald-500/20" 
                                  : "bg-gray-800"
                              }`}
                              title={`Pkt ${idx}: ${chunk !== null ? "Assembled" : "Empty Block"}`}
                            />
                          ))}
                        </div>
                        
                        <div className="mt-2.5 flex justify-between items-center text-[9px] text-gray-500 font-mono uppercase">
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" /> Block Assembled
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-gray-800 rounded-full" /> Block Missing
                          </span>
                        </div>
                      </div>

                      {/* Display live ACK feed on screen for reverse webcam channel */}
                      <div className="flex flex-col items-center justify-center bg-[#0a0c10]/80 p-5 rounded-xl border border-gray-800">
                        <div className="text-center font-mono text-[10px] text-gray-400 uppercase tracking-widest mb-3 font-semibold">
                          Reverse ACK feedback barcode (Aim sender at this)
                        </div>
                        <div className="aspect-square bg-white rounded-lg p-2 max-w-[210px] max-h-[210px] flex items-center justify-center shadow-2xl border border-gray-800/55">
                          <canvas ref={ackCanvasRef} width={210} height={210} className="w-full h-full object-contain" />
                        </div>
                        <div className="mt-2.5 text-center text-[9px] text-gray-500 font-mono truncate max-w-sm uppercase">
                          Payload Ack: {activeAckPayload ? activeAckPayload.slice(0, 48) + "..." : "Calculating ACK..."}
                        </div>
                      </div>

                      {/* Receiver statistics chart */}
                      <ThroughputChart
                        history={receiverSpeedHistory}
                        currentSpeed={receiverStats.currentSpeed}
                        averageSpeed={receiverStats.averageSpeed}
                        progress={receiverStats.progressPercentage}
                      />

                      {/* Receiver error alert blocks (duplicate or corruption alarms) */}
                      {(receiverStats.corruptedPackets > 0 || receiverStats.duplicatedPackets > 0) && (
                        <div className="p-3 bg-red-950/20 rounded-xl border border-red-500/20 font-mono text-[10px] flex justify-between text-red-400 leading-normal">
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 animate-bounce" />
                            <span>Transport Correction Logging:</span>
                          </div>
                          <div className="flex gap-4">
                            <span>Corrupted Drops: <strong className="text-red-500">{receiverStats.corruptedPackets}</strong></span>
                            <span>Duplicated Skips: <strong className="text-indigo-400">{receiverStats.duplicatedPackets}</strong></span>
                          </div>
                        </div>
                      )}

                      {/* Actions Panel */}
                      <div className="flex gap-3 justify-end">
                        {receiverStatus === "completed" && downloadUrl && (
                          <a
                            href={downloadUrl}
                            download={receiverMetadata?.filename || "lumina_assembled.bin"}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-xs font-bold font-mono text-white rounded-lg transition-colors shadow-lg shadow-emerald-500/10 cursor-pointer flex items-center gap-1.5"
                          >
                            <Check className="w-3.5 h-3.5" /> Re-Download
                          </a>
                        )}
                        <button
                          onClick={resetReceiver}
                          className="px-3.5 py-1.5 bg-gray-900 border border-gray-800 hover:bg-[#0f1218] rounded-lg text-xs font-mono text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
                        >
                          Cancel / Reset
                        </button>
                      </div>

                      {/* Direct physical camera decoding (Receiver camera scanning Sender 2x2 grid) */}
                      {!simMode && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-2 px-1">
                            <Info className="w-3.5 h-3.5 text-gray-500" />
                            <span className="text-[10px] font-mono text-gray-500 uppercase">
                              Receiver Forward Webcam Link (Aim at sender 2x2 grid)
                            </span>
                          </div>
                          <QuadrantScanner
                            isActive={receiverStatus === "active"}
                            onQrScanned={(data, qIdx) => handleReceivePacket(data, qIdx)}
                          />
                        </div>
                      )}

                    </div>
                  )}

                </div>
              )}

            </div>
          </div>
        )}

        {/* RECENT PERFORMANCE AWARDS AND DESIGN ARCHITECTURE PANEL */}
        <section className="mt-12 bg-[#0f1218] border border-gray-800 rounded-2xl p-6 sm:p-8">
          <div className="flex items-center gap-2 mb-5">
            <Award className="w-5 h-5 text-blue-500" />
            <h3 className="font-bold text-sm text-white uppercase tracking-wider font-mono">
              The Lumina Optic Protocol Suite
            </h3>
          </div>
          
          <div className="grid md:grid-cols-3 gap-6 text-xs text-gray-400 leading-relaxed">
            <div className="bg-[#0a0c10]/60 p-5 rounded-xl border border-gray-800">
              <h5 className="font-bold text-white mb-2 font-mono">Parallel Quadrant Framing</h5>
              <p>
                Divides incoming HD/720p webcam frames into 4 overlapping quadrants. Evaluates 4 separate local QR scan instances in parallel within a single rendering pass, multiplying transport capacity up to 400%.
              </p>
            </div>
            <div className="bg-[#0a0c10]/60 p-5 rounded-xl border border-gray-800">
              <h5 className="font-bold text-white mb-2 font-mono">Air-gapped Bidirectional Loop</h5>
              <p>
                Implements continuous sliding window (ARQ). The receiver projects a reverse ACK QR. Under heavy light drop or camera glares, sender instantly reschedules missing blocks without interrupting transmission.
              </p>
            </div>
            <div className="bg-[#0a0c10]/60 p-5 rounded-xl border border-gray-800">
              <h5 className="font-bold text-white mb-2 font-mono">Integrity Compression Layer</h5>
              <p>
                Pre-compresses file streams natively with modern in-browser GZIP blocks, drastically shrinking visual frame payload demands. Restores original files automatically using CRC32 byte check verification.
              </p>
            </div>
          </div>
        </section>

      </main>

      {/* Elegant minimalist footer */}
      <footer className="mt-16 text-center text-[10px] text-gray-650 font-mono tracking-widest relative z-20 uppercase pb-6">
        LUMINA-LP v1.1.2 &bull; ZERO NETWORK OPTICAL TRANSCEIVER &bull; NO INTERNET REQUIRED
      </footer>
    </div>
  );
}
