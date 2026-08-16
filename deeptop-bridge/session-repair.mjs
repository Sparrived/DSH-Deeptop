// Last-resort recovery for a DSH JSONL session log that the persistence backend
// refuses to open. DSH's `readZstdPrefix` throws "corrupt Zstandard session log:
// complete frame contains a torn JSONL record" when a crash leaves the last
// complete Zstandard frame ending mid-record, and — unlike a structurally torn
// final frame — it does not salvage anything: the session becomes unopenable.
//
// This module repairs such logs the same way DSH already recovers a torn final
// frame: keep every committed record, drop the uncommitted torn tail, and
// rebuild the log as a checksummed header frame plus complete event frames. The
// reader is layout-blind, so preserving records verbatim (packed chunk rows
// included) is lossless. The rebuilt log is validated before it is returned,
// and a log that is already readable is reported as an unchanged no-op.
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";

const ZSTD_MAGIC = 4247762216; // 0xFD2FB528 little-endian
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
const INCOMPLETE_FRAME_OPTIONS = { finishFlush: constants.ZSTD_e_flush };
/** Rebuild the log as one frame per small batch, mirroring DSH's append shape. */
const FRAME_CHUNK_LINES = 512;

/**
 * Locate complete frames without decompressing their blocks, matching
 * `scanZstdFrames` in @deepseek-ai/dsh-session-persistence-jsonl. Invalid
 * complete structure throws; EOF inside the final frame returns its start.
 * @param buffer - complete bytes currently present in the session artifact.
 * @returns complete frame ranges and an optional incomplete-final-frame start.
 */
export function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) {
      throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`);
    }
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = blockHeader >>> 1 & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

/** Compress one independently decodable, checksummed Zstandard frame. */
function compressFrame(text) {
  return zstdCompressSync(Buffer.from(text, "utf8"), CHECKSUM_OPTIONS);
}

/**
 * Split plaintext into committed JSONL records. The final element of
 * `split("\n")` is `""` when the text ended with a newline, otherwise it is a
 * torn partial record — either way it carries no committed record and is
 * dropped. Empty lines and lines that are not valid JSON are also dropped and
 * counted as torn, because a committed storage record is always one JSON line.
 * @param text - decompressed JSONL (header line first).
 * @returns the committed records and the number of dropped lines.
 */
export function extractRecords(text) {
  const lines = text.split("\n");
  let dropped = 0;
  if (lines.length > 0) {
    // The final element is "" after a clean trailing newline, or a torn
    // partial record; either way it carries no committed record. Count the
    // torn partial so callers can report what was lost.
    if (lines.pop() !== "") dropped += 1;
  }
  const records = [];
  for (const line of lines) {
    if (line === "") continue;
    try {
      JSON.parse(line);
    } catch {
      dropped += 1;
      continue;
    }
    records.push(line);
  }
  return { records, dropped };
}

/**
 * Rebuild a session log from its committed records. The header is preserved
 * verbatim; event records are written unpacked-verbatim in order, chunked into
 * frames so one huge frame never stalls the event loop during a later read.
 * @param header - the committed first line (without its newline).
 * @param events - committed event records (without trailing newlines).
 * @returns the rebuilt artifact bytes.
 */
export function encodeLog(header, events) {
  const frames = [compressFrame(`${header}\n`)];
  for (let i = 0; i < events.length; i += FRAME_CHUNK_LINES) {
    const body = events.slice(i, i + FRAME_CHUNK_LINES).join("\n");
    frames.push(compressFrame(body.length > 0 ? `${body}\n` : ""));
  }
  return Buffer.concat(frames);
}

/**
 * Validate that a rebuilt log is readable by the same rules DSH applies to a
 * complete artifact: every complete frame decodes, the first frame is exactly
 * one header line, every event record is valid JSON, and no torn tail remains.
 * @param bytes - the artifact bytes to validate.
 * @returns `null` when readable, otherwise a human-readable failure reason.
 */
export function verifyReadable(bytes) {
  let frames;
  try {
    frames = scanZstdFrames(bytes).frames;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (frames.length === 0) return "no readable header frame";
  let committed = 0;
  let input = 0;
  for (let i = 0; i < frames.length; i++) {
    let plain;
    try {
      plain = zstdDecompressSync(bytes.subarray(frames[i].start, frames[i].end));
    } catch (error) {
      return `frame ${i} failed to decode: ${error instanceof Error ? error.message : String(error)}`;
    }
    input += plain.length;
    if (i === 0) {
      if (plain.length === 0 || plain.indexOf(10) !== plain.length - 1) {
        return "header frame is not exactly one header line";
      }
      committed += plain.length;
      continue;
    }
    let lineStart = 0;
    for (let nl = plain.indexOf(10); nl !== -1; nl = plain.indexOf(10, lineStart)) {
      try {
        JSON.parse(plain.subarray(lineStart, nl).toString("utf8"));
      } catch {
        return `event record at byte ${frames[i].start + lineStart} is not valid JSON`;
      }
      committed += nl - lineStart + 1;
      lineStart = nl + 1;
    }
  }
  if (committed !== input) return "a torn JSONL record remains";
  return null;
}

/**
 * Repair a session log artifact in memory. The committed prefix is preserved,
 * the uncommitted torn tail (and any undecodable trailing frames) is dropped,
 * and the log is rebuilt and validated. A log that is already readable is
 * reported as an unchanged no-op.
 * @param buffer - the raw artifact bytes.
 * @returns `{ bytes, header, recoveredEvents, droppedTorn, changed }`.
 * @throws when the log has no readable header and cannot be repaired at all.
 */
export function repairCorruptLog(buffer) {
  const { frames, tornStart } = scanZstdFrames(buffer);
  if (frames.length === 0) {
    throw new Error("会话日志没有可读的 Zstandard 头部帧，无法修复");
  }
  const plaintexts = [];
  let goodFrames = 0;
  for (const frame of frames) {
    try {
      plaintexts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)));
      goodFrames += 1;
    } catch {
      break; // stop at the first undecodable complete frame; bytes after it are untrusted
    }
  }
  if (plaintexts.length === 0) {
    throw new Error("会话日志头部帧无法解码，无法修复");
  }
  const completeText = Buffer.concat(plaintexts).toString("utf8");
  const { records: completeRecords, dropped: droppedComplete } = extractRecords(completeText);
  if (completeRecords.length === 0) {
    throw new Error("会话日志没有头部记录，无法修复");
  }
  const header = completeRecords[0];
  let parsedHeader;
  try {
    parsedHeader = JSON.parse(header);
  } catch {
    throw new Error("会话日志头部记录不是有效 JSON，无法修复");
  }
  if (!parsedHeader || typeof parsedHeader !== "object" || parsedHeader.type !== "session") {
    throw new Error("会话日志头部记录不是会话头部，无法修复");
  }
  const events = completeRecords.slice(1);
  let droppedTorn = droppedComplete;
  // Salvage complete records from a structurally torn final frame, matching
  // DSH's torn-marker recovery (ZSTD_e_flush suppresses checksum completion).
  if (tornStart !== undefined) {
    try {
      const tornText = zstdDecompressSync(buffer.subarray(tornStart), INCOMPLETE_FRAME_OPTIONS).toString("utf8");
      const { records: tornRecords, dropped: droppedTornFrame } = extractRecords(tornText);
      events.push(...tornRecords);
      droppedTorn += droppedTornFrame;
    } catch {
      // The torn frame did not decode to usable plaintext; drop it entirely.
    }
  }
  const bytes = encodeLog(header, events);
  const validationError = verifyReadable(bytes);
  if (validationError !== null) {
    throw new Error(`修复后的会话日志未通过校验，已放弃写入：${validationError}`);
  }
  const changed = droppedTorn > 0 || tornStart !== undefined || goodFrames < frames.length;
  return {
    bytes,
    header,
    recoveredEvents: events.length,
    droppedTorn,
    changed,
  };
}
