import { closeSync, fstatSync, openSync, readSync } from "fs";

/** Absolute byte offsets for one JSONL line. */
export interface JsonlLinePosition {
  /** First byte of the line. */
  start: number;
  /** One past the line's last byte (the newline is not included). */
  end: number;
  /** First byte of the next line (end + newline, or end at EOF). */
  next: number;
}

export interface JsonlReadOptions {
  /** First byte to read; must be a returned line boundary. */
  start?: number;
  /** Fixed upper bound: bytes at or after this offset are never read. */
  maxEnd?: number;
}

/**
 * Stream a JSONL file line-by-line without materializing it as one string.
 * Large sessions can exceed V8's maximum string length before parsing even
 * starts (PR #26), so every reader shares this chunked splitter.
 *
 * Calls `onLine` per line (empty lines included; callers skip them) with the
 * line's absolute byte position. Returning `false` stops the scan without
 * reading further. The optional `start`/`maxEnd` bounds let one logical scan
 * resume from a fixed byte boundary; a trailing record cut off by `maxEnd`
 * is never emitted. Returns false when the file does not exist — Pi does not
 * create a new session's JSONL until its first persisted entry — and
 * rethrows other IO errors.
 */
export const forEachJsonlLine = (
  file: string,
  onLine: (line: Buffer, position: JsonlLinePosition) => void | boolean,
  options: JsonlReadOptions = {},
): boolean => {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw err;
  }

  const start = Math.max(0, Math.floor(options.start ?? 0));
  const fileSize = fstatSync(fd).size;
  const maxEnd = options.maxEnd == null ? fileSize : Math.max(start, Math.min(fileSize, Math.floor(options.maxEnd)));

  const chunk = Buffer.allocUnsafe(64 * 1024);
  let pending: Buffer[] = [];
  let pendingLength = 0;
  let lineStart = start;
  let position = start;
  let stopped = false;

  try {
    // A zero-byte range would skip the read loop; a directory or other
    // unreadable path must still surface its IO error (and an empty file
    // still returns 0).
    if (maxEnd <= start) readSync(fd, chunk, 0, 1, start);

    while (!stopped && position < maxEnd) {
      const want = Math.min(chunk.length, maxEnd - position);
      const bytesRead = readSync(fd, chunk, 0, want, position);
      if (bytesRead <= 0) break;

      const chunkStart = position;
      position += bytesRead;
      let segmentStart = 0;

      for (let i = 0; i < bytesRead; i++) {
        if (chunk[i] !== 0x0a) continue;

        const absoluteEnd = chunkStart + i;
        let line: Buffer;
        if (pendingLength > 0) {
          const segment = chunk.subarray(segmentStart, i);
          pending.push(segment);
          line = Buffer.concat(pending, pendingLength + segment.length);
          pending = [];
          pendingLength = 0;
        } else {
          line = chunk.subarray(segmentStart, i);
        }
        segmentStart = i + 1;
        const linePosition: JsonlLinePosition = { start: lineStart, end: absoluteEnd, next: absoluteEnd + 1 };
        lineStart = absoluteEnd + 1;
        if (onLine(line, linePosition) === false) {
          stopped = true;
          break;
        }
      }

      if (stopped) break;
      if (segmentStart < bytesRead) {
        const remainder = Buffer.from(chunk.subarray(segmentStart, bytesRead));
        if (pendingLength === 0) lineStart = chunkStart + segmentStart;
        pending.push(remainder);
        pendingLength += remainder.length;
      }
    }

    // Emit a final partial line only when the file itself ended; a record cut
    // off by a fixed maxEnd belongs to content appended after the scan began.
    if (!stopped && pendingLength > 0 && position >= fileSize) {
      onLine(Buffer.concat(pending, pendingLength), { start: lineStart, end: position, next: position });
    }
  } finally {
    closeSync(fd);
  }
  return true;
};
