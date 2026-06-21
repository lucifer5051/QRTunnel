// CRC32 table initialization
const crcTable: number[] = [];
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c;
}

/**
 * Computes the CRC32 checksum of a Uint8Array.
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Encodes a Uint8Array to a Base64 string.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a Base64 string back to a Uint8Array.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compresses data using native CompressionStream (GZIP).
 */
export async function compressData(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data).body?.pipeThrough(new CompressionStream("gzip"));
  if (!stream) {
    throw new Error("CompressionStream is not supported in this browser.");
  }
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Decompresses GZIP-compressed data using DecompressionStream.
 */
export async function decompressData(compressedData: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(compressedData).body?.pipeThrough(new DecompressionStream("gzip"));
  if (!stream) {
    throw new Error("DecompressionStream is not supported in this browser.");
  }
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Generates a standard random 4-character hex identifier.
 */
export function generateTransferId(): string {
  return Math.floor(Math.random() * 65536).toString(16).padStart(4, "0");
}

/**
 * Compacts a list of sorted, unique packet indices into a range string.
 * Example: [1, 2, 3, 5, 8, 9, 10] => "1-3,5,8-10"
 */
export function compactRanges(numbers: number[]): string {
  if (numbers.length === 0) return "";
  
  // Ensure sorted and unique
  const sorted = Array.from(new Set(numbers)).sort((a, b) => a - b);
  const segments: string[] = [];
  
  let rangeStart = sorted[0];
  let previous = sorted[0];
  
  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    if (current === previous + 1) {
      previous = current;
    } else {
      if (rangeStart === previous) {
        segments.push(`${rangeStart}`);
      } else {
        segments.push(`${rangeStart}-${previous}`);
      }
      if (current !== undefined) {
        rangeStart = current;
        previous = current;
      }
    }
  }
  
  return segments.join(",");
}

/**
 * Parses a range string back into an array of integers.
 * Example: "1-3,5,8-10" => [1, 2, 3, 5, 8, 9, 10]
 */
export function parseRanges(rangeStr: string): number[] {
  if (!rangeStr) return [];
  
  const result: number[] = [];
  const parts = rangeStr.split(",");
  
  for (const part of parts) {
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          result.push(i);
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num)) {
        result.push(num);
      }
    }
  }
  
  // Sort and deduplicate
  return Array.from(new Set(result)).sort((a, b) => a - b);
}

/**
 * Serializes a forward channel data packet.
 * Format: OFT|[TransferID]|[PktIndex]|[TotalPkts]|[ChecksumHex]|[Base64Payload]
 */
export function serializePacket(transferId: string, index: number, totalPackets: number, checksum: number, payloadBase64: string): string {
  const checksumHex = checksum.toString(16).padStart(8, "0");
  return `OFT|${transferId}|${index}|${totalPackets}|${checksumHex}|${payloadBase64}`;
}

export interface DecodedPacket {
  prefix: string;
  transferId: string;
  index: number;
  totalPackets: number;
  checksum: number;
  payloadBase64: string;
}

/**
 * Deserializes a forward channel data packet.
 */
export function deserializePacket(packetStr: string): DecodedPacket | null {
  if (!packetStr.startsWith("OFT|")) return null;
  const parts = packetStr.split("|");
  if (parts.length < 6) return null;
  
  const prefix = parts[0];
  const transferId = parts[1];
  const index = parseInt(parts[2], 10);
  const totalPackets = parseInt(parts[3], 10);
  const checksum = parseInt(parts[4], 16);
  // The rest can contain base64, sometimes split-by-pipe-safest is joining
  const payloadBase64 = parts.slice(5).join("|");
  
  if (isNaN(index) || isNaN(totalPackets) || isNaN(checksum)) return null;
  
  return {
    prefix,
    transferId,
    index,
    totalPackets,
    checksum,
    payloadBase64
  };
}

/**
 * Serializes a reverse channel ACK packet.
 * Format: OFTACK|[TransferID]|[ContinuousPkt]|[MissingRanges]
 * Or complete format: OFTACK|[TransferID]|DONE
 */
export function serializeAck(transferId: string, continuousPkt: number, missingRanges: string, isDone: boolean = false): string {
  if (isDone) {
    return `OFTACK|${transferId}|DONE`;
  }
  return `OFTACK|${transferId}|${continuousPkt}|${missingRanges}`;
}

export interface DecodedAck {
  transferId: string;
  isDone: boolean;
  continuousPkt: number;
  missingPackets: number[];
}

/**
 * Deserializes a reverse channel ACK packet.
 */
export function deserializeAck(ackStr: string): DecodedAck | null {
  if (!ackStr.startsWith("OFTACK|")) return null;
  const parts = ackStr.split("|");
  if (parts.length < 3) return null;
  
  const transferId = parts[1];
  const statusOrContinuous = parts[2];
  
  if (statusOrContinuous === "DONE") {
    return {
      transferId,
      isDone: true,
      continuousPkt: -1,
      missingPackets: []
    };
  }
  
  const continuousPkt = parseInt(statusOrContinuous, 10);
  if (isNaN(continuousPkt)) return null;
  
  const rangesStr = parts[3] || "";
  const missingPackets = parseRanges(rangesStr);
  
  return {
    transferId,
    isDone: false,
    continuousPkt,
    missingPackets
  };
}
