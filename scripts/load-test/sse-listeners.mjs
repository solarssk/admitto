#!/usr/bin/env node
/**
 * SSE side of the check-in load test (.github/workflows/load-test.yml): signs in the seeded
 * "listener" operators, opens the live check-in stream (GET /api/checkin/events/:id/stream) three
 * times per account (the per-operator, per-event cap), counts the `checkin` events each stream
 * receives, and also checks that a fourth stream on the same account is refused. Runs until it gets
 * SIGTERM, then writes the counts to the output file. The workflow compares them with the number
 * of VALID check-ins in the database: every stream must have received exactly that many.
 *
 * Usage: BASE_URL=... node scripts/load-test/sse-listeners.mjs <seed.json> <out.json>
 */
import { readFile, writeFile } from "node:fs/promises";

const BASE_URL = process.env.BASE_URL;
const [seedPath, outPath] = process.argv.slice(2);
if (!BASE_URL || !seedPath || !outPath) {
  console.error("BASE_URL, <seed.json> and <out.json> are required");
  process.exit(2);
}

const seed = JSON.parse(await readFile(seedPath, "utf8"));
const origin = new URL(BASE_URL).origin;
const eventId = String(seed.eventId);
if (!/^[A-Za-z0-9_-]+$/.test(eventId))
  throw new Error("unexpected event id in the seed file");
const streamUrl = `${BASE_URL}/api/checkin/events/${encodeURIComponent(eventId)}/stream`;
const stop = new AbortController();

async function login({ email, password }) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status}`);
  const cookie = res.headers.getSetCookie().find((c) => /session/i.test(c));
  if (!cookie) throw new Error(`no session cookie for ${email}`);
  return cookie.split(";")[0];
}

const streams = [];

/** The `type` of one SSE frame's `data:` line, or null when it has none or is not JSON. */
function frameType(frame) {
  const data = frame.split("\n").find((line) => line.startsWith("data:"));
  if (!data) return null;
  try {
    return JSON.parse(data.slice(5)).type;
  } catch {
    // A malformed frame counts as nothing rather than crashing the listener.
    return null;
  }
}

/** Counts every complete frame in `buffered` and returns what is left (an unfinished frame). */
function consumeFrames(buffered, counts) {
  let rest = buffered;
  let end = rest.indexOf("\n\n");
  while (end !== -1) {
    const type = frameType(rest.slice(0, end));
    if (type === "checkin") counts.checkin += 1;
    else if (type === "ping") counts.ping += 1;
    rest = rest.slice(end + 2);
    end = rest.indexOf("\n\n");
  }
  return rest;
}

async function listen(label, cookie) {
  const counts = { label, status: 0, checkin: 0, ping: 0 };
  streams.push(counts);
  const res = await fetch(streamUrl, {
    headers: { Cookie: cookie, Accept: "text/event-stream" },
    signal: stop.signal,
  });
  counts.status = res.status;
  if (!res.ok || !res.body) return;
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for await (const chunk of res.body) {
      buffered = consumeFrames(
        buffered + decoder.decode(chunk, { stream: true }),
        counts,
      );
    }
  } catch (err) {
    if (err.name !== "AbortError") throw err;
  }
}

const sessions = [];
for (const [i, account] of seed.listeners.entries()) {
  sessions.push({ i, cookie: await login(account) });
}
const running = sessions.flatMap(({ i, cookie }) =>
  [0, 1, 2].map((n) => listen(`listener${i}-stream${n}`, cookie)),
);

// Let the streams register, then a fourth on the first account must be refused.
await new Promise((r) => setTimeout(r, 1000));
const extra = await fetch(streamUrl, {
  headers: { Cookie: sessions[0].cookie, Accept: "text/event-stream" },
  signal: stop.signal,
});
const refused = extra.status;
await extra.body?.cancel();
console.log(
  `[sse] ${running.length} streams open, fourth-stream status ${refused}`,
);

await new Promise((resolve) => process.once("SIGTERM", resolve));
// Give events still in flight a moment to arrive before closing.
await new Promise((r) => setTimeout(r, 2000));
stop.abort();
await Promise.allSettled(running);
// Rebuilt from plain numbers so nothing read off the wire is written to disk as-is.
const report = {
  fourthStreamStatus: Number(refused),
  streams: streams.map((s) => ({
    label: s.label,
    status: Number(s.status),
    checkin: Number(s.checkin),
    ping: Number(s.ping),
  })),
};
await writeFile(outPath, JSON.stringify(report, null, 2));
console.log(`[sse] wrote ${outPath}`);
