/**
 * In-memory, per-process live-tail buffer for the admin "System logs" viewer. This is a
 * convenience layer for watching activity while the app is up, not a durability mechanism -
 * every entry is also written to stdout via console.*, which Docker already captures to disk
 * independent of this buffer (see docs/SECURITY-CONTROLS.md's "forward container logs if
 * required" stance for external/SIEM shipping). Deliberately not re-exported from "./index.js":
 * this module holds real mutable module-level state, and that barrel is also consumed by the
 * browser bundle (apps/admin) - import from "@admitto/shared/system-log" instead.
 */

export type SystemLogLevel = "info" | "warn" | "error";
export type SystemLogSource = "api" | "db" | "cache" | "mail" | "admin" | "security";

export interface SystemLogEntry {
  id: number;
  ts: string;
  level: SystemLogLevel;
  source: SystemLogSource;
  message: string;
  fields?: Record<string, unknown>;
}

export interface SystemLogQuery {
  sinceId?: number;
  level?: SystemLogLevel;
  source?: SystemLogSource;
  search?: string;
}

const CAPACITY = 1000;

let buffer: SystemLogEntry[] = [];
let nextId = 1;

/** Append to the in-memory buffer only (no console output) - used internally by
 * emitSystemLog() and directly by tests that want to populate the buffer without
 * producing stdout noise. */
export function recordSystemLog(entry: {
  level: SystemLogLevel;
  source: SystemLogSource;
  message: string;
  fields?: Record<string, unknown>;
}): SystemLogEntry {
  const recorded: SystemLogEntry = {
    id: nextId++,
    ts: new Date().toISOString(),
    ...entry,
  };
  buffer.push(recorded);
  if (buffer.length > CAPACITY) buffer.shift();
  return recorded;
}

/** The dual-sink primitive every producer should call instead of raw console.* - writes the
 * same JSON-line shape apps/web/src/logger.ts already writes to stdout, then records into the
 * in-memory buffer. Centralizing this in one function means "also emit to the buffer" can't be
 * forgotten at a new call site. */
export function emitSystemLog(
  source: SystemLogSource,
  level: SystemLogLevel,
  message: string,
  fields?: Record<string, unknown>,
): void {
  console[level](JSON.stringify({ level, msg: message, ts: new Date().toISOString(), ...fields }));
  recordSystemLog({ level, source, message, fields });
}

/** Entries with id > sinceId (or all, if omitted), oldest-first, filtered by level/source and a
 * case-insensitive substring match against the message. */
export function querySystemLogs(query: SystemLogQuery = {}): SystemLogEntry[] {
  const { sinceId, level, source, search } = query;
  const needle = search?.trim().toLowerCase();
  return buffer.filter((entry) => {
    if (sinceId !== undefined && entry.id <= sinceId) return false;
    if (level && entry.level !== level) return false;
    if (source && entry.source !== source) return false;
    if (needle && !entry.message.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** The buffer's true high-water mark, independent of any filter - callers should return this as
 * the next poll's cursor so widening a filter mid-session never silently skips entries that
 * existed under the old filter but weren't returned by it. */
export function currentSystemLogCursor(): number {
  return nextId - 1;
}

/** @internal test-only - clears the buffer and resets the id counter between test cases, since
 * this module's state is a process-wide singleton shared across an entire test file. */
export function resetSystemLogBufferForTest(): void {
  buffer = [];
  nextId = 1;
}
