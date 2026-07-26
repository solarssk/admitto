/**
 * Pure helpers for deciding whether a Prisma query event is worth a system-log line, and for
 * formatting that line. Kept dependency-free (no Prisma import, no @admitto/shared import) so it
 * stays trivially unit-testable and has no side effects of its own.
 */

const SLOW_QUERY_THRESHOLD_MS = 200;

/**
 * Logging every query would flood the ring buffer's 1000-entry cap and add per-request
 * overhead, so only genuinely slow queries are worth a live-tail line.
 */
export function isSlowQuery(durationMs: number): boolean {
  return durationMs >= SLOW_QUERY_THRESHOLD_MS;
}

/**
 * Takes only the parameterized query template and its duration - never Prisma's own "params"
 * field (raw bind values, which can contain attendee PII). Accepting primitives here instead of
 * the whole Prisma.QueryEvent makes leaking params structurally impossible, not just a matter of
 * remembering not to.
 */
export function formatSlowQueryMessage(query: string, durationMs: number): string {
  return `Slow query (${durationMs}ms): ${query}`;
}
