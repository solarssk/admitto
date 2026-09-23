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
const streamUrl = `${BASE_URL}/api/checkin/events/${seed.eventId}/stream`;
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
      buffered += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffered.indexOf("\n\n")) !== -1) {
        const frame = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const data = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!data) continue;
        try {
          const type = JSON.parse(data.slice(5)).type;
          if (type === "checkin") counts.checkin += 1;
          else if (type === "ping") counts.ping += 1;
        } catch {
          // A malformed frame is counted as nothing rather than crashing the listener.
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") throw err;
  }
}

const running = [];
let refused = null;
for (const [i, account] of seed.listeners.entries()) {
  const cookie = await login(account);
  for (let n = 0; n < 3; n++)
    running.push(listen(`listener${i}-stream${n}`, cookie));
  if (i === 0) {
    // Let the three streams register, then a fourth on the same account must be refused.
    await new Promise((r) => setTimeout(r, 1000));
    const extra = await fetch(streamUrl, {
      headers: { Cookie: cookie, Accept: "text/event-stream" },
      signal: stop.signal,
    });
    refused = extra.status;
    await extra.body?.cancel();
  }
}
console.log(
  `[sse] ${running.length} streams open, fourth-stream status ${refused}`,
);

await new Promise((resolve) => process.once("SIGTERM", resolve));
// Give events still in flight a moment to arrive before closing.
await new Promise((r) => setTimeout(r, 2000));
stop.abort();
await Promise.allSettled(running);
await writeFile(
  outPath,
  JSON.stringify({ fourthStreamStatus: refused, streams }, null, 2),
);
console.log(`[sse] wrote ${outPath}`);
