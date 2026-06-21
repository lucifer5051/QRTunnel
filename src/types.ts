export type TransferRole = "send" | "receive" | "none";

export type TransferStatus = "idle" | "preparing" | "active" | "paused" | "completed" | "error";

export interface TransferMetadata {
  id: string;
  filename: string;
  originalSize: number;
  compressedSize: number;
  totalPackets: number; // excluding metadata packet (packet 0 is metadata)
  chunkSize: number;
}

export interface Packet {
  index: number; // 0 = Metadata, 1..N = Data segments
  checksum: number; // CRC32
  data: string; // Base64 chunk
}

export interface TransferStats {
  bytesTransferred: number;
  packetsTotal: number;
  packetsProcessed: number; // uniquely received or successfully acknowledged
  packetsScanned: number; // total QR barcodes parsed
  corruptedPackets: number;
  duplicatedPackets: number;
  retransmissionsCount: number;
  currentSpeed: number; // in KB/s
  averageSpeed: number; // in KB/s
  progressPercentage: number;
  elapsedSeconds: number;
}

export interface ProtocolConfig {
  chunkSize: number; // payload bytes per QR (e.g., 100 - 800)
  frameDelay: number; // display delay per tick in ms (e.g., 30 - 300)
  errorCorrectionLevel: "L" | "M" | "Q" | "H";
  windowSize: number; // sliding window size (e.g., 16 - 128)
}
