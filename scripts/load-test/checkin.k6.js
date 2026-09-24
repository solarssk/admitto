// k6 load test for the check-in hot path (.github/workflows/load-test.yml).
//
// Two scenarios run at once against POST /api/checkin/admit and /api/checkin/scan (alternating),
// several operator accounts at once:
//   - distinct: each attendee is admitted exactly once (many different attendees in parallel).
//   - contested: every contender attempts each attendee in the same one-second slot; exactly one
//     may win. The authoritative checks are database queries after the run (see the workflow: no
//     attendee with two VALID rows, and exactly one VALID per contested attendee); the k6 side
//     counts outcomes so a mismatch is visible in the summary.
//
// No latency thresholds: there is no baseline yet to justify any number. It records p95/p99,
// error rate and throughput per run; only correctness (every response 200 with a known status,
// no 429/5xx) fails the run.
//
// Inputs: BASE_URL and SEED_FILE (path to the JSON written by scripts/load-test/seed.ts). The seed
// must contain one operator per VU: the contested scenario's CONTENDERS VUs plus the rest for the
// distinct scenario.
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import exec from "k6/execution";
import { SharedArray } from "k6/data";

const BASE_URL = __ENV.BASE_URL;
const SEED_FILE = __ENV.SEED_FILE;
const CONTENDERS = 3;
const PAUSE_SECONDS = 0.8; // ~1.25 req/s per operator, under the 120/min per-operator rate limit

const seed = new SharedArray("seed", () => [JSON.parse(open(SEED_FILE))])[0];
const LOGIN_STAGGER_SECONDS = 0.5;
// The contested scenario waits until every staggered login has finished, plus a margin, then gives
// each attendee its own one-second slot that all contenders fire in together.
const CONTEST_START_MS =
  seed.operators.length * LOGIN_STAGGER_SECONDS * 1000 + 1000;
const CONTEST_SLOT_MS = 1000;
const validAdmits = new Counter("admit_valid");
const alreadyAdmitted = new Counter("admit_already_checked_in");
const unexpected = new Counter("admit_unexpected_status");

export const options = {
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
  // Each VU signs in once and keeps its session; by default k6 clears the cookie jar every iteration.
  noCookiesReset: true,
  scenarios: {
    distinct: {
      executor: "constant-vus",
      vus: seed.operators.length - CONTENDERS,
      duration: "60s",
      exec: "admitDistinct",
    },
    contested: {
      // Every contender attempts every contested attendee, in lockstep (see admitContested).
      executor: "per-vu-iterations",
      vus: CONTENDERS,
      iterations: seed.contested.length,
      maxDuration: "3m",
      exec: "admitContested",
    },
  },
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate==0"],
    // Always true: declaring a threshold is how k6 materialises the per-endpoint sub-metric that
    // handleSummary reads p95/p99 from. Not a latency budget (there is no baseline to set one).
    "http_req_duration{name:admit}": ["max>=0"],
    "http_reqs{name:admit}": ["count>=0"],
    "http_req_duration{name:scan}": ["max>=0"],
    "http_reqs{name:scan}": ["count>=0"],
  },
};

let loggedIn = false;
let failuresLogged = 0;

function ensureLoggedIn() {
  if (loggedIn) return;
  // Login is rate limited to 10 per minute per client IP, and every VU here shares one IP, so
  // stagger the first logins rather than have them all land in the same instant.
  sleep(exec.vu.idInTest * LOGIN_STAGGER_SECONDS);
  // One account per VU: a new login for an account ends that account's earlier sessions, so two
  // VUs sharing one would keep signing each other out.
  const operator = seed.operators[exec.vu.idInTest - 1];
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: operator.email, password: operator.password }),
    {
      headers: { "Content-Type": "application/json", Origin: BASE_URL },
      tags: { name: "login" },
    },
  );
  loggedIn = check(res, {
    "login ok": (r) => r.status === 200 && r.json("next") === "complete",
  });
  if (!loggedIn)
    console.error(
      `login failed for VU ${exec.vu.idInTest}: ${res.status} ${res.body}`,
    );
}

// Alternate between the two ways a gate operator checks someone in: POST /api/checkin/admit by
// attendee id (what the manual lookup does) and POST /api/checkin/scan with the QR payload. Both
// end in the same admission code path, so both are covered by the same double-admit checks.
// `accepted` is the set of statuses that are correct for this caller: a fresh attendee must come
// back VALID; a contested one may be VALID (the winner) or ALREADY_CHECKED_IN (everyone else).
function checkIn(person, index, accepted) {
  const byScan = index % 2 === 1;
  const name = byScan ? "scan" : "admit";
  const payload = {
    eventId: seed.eventId,
    deviceId: `k6-vu-${exec.vu.idInTest}`,
    ...(byScan
      ? { scanned: person.qr }
      : { attendeeId: person.id, method: "scan" }),
  };
  const res = http.post(
    `${BASE_URL}/api/checkin/${name}`,
    JSON.stringify(payload),
    {
      headers: { "Content-Type": "application/json", Origin: BASE_URL },
      tags: { name },
    },
  );
  const ok = check(res, { [`${name} returned 200`]: (r) => r.status === 200 });
  if (!ok) {
    // Log only the first few failures per VU so a broken run is diagnosable without flooding.
    failuresLogged += 1;
    if (failuresLogged <= 3) {
      console.error(
        `${name} failed: ${res.status} ${String(res.body).slice(0, 200)}`,
      );
    }
    return;
  }
  const status = res.json("status");
  if (status === "VALID") validAdmits.add(1);
  else if (status === "ALREADY_CHECKED_IN") alreadyAdmitted.add(1);
  else unexpected.add(1);
  check(res, { "status is the expected one": () => accepted.includes(status) });
}

export function admitDistinct() {
  ensureLoggedIn();
  const i = exec.scenario.iterationInTest;
  if (i >= seed.distinct.length) {
    sleep(PAUSE_SECONDS);
    return;
  }
  checkIn(seed.distinct[i], i, ["VALID"]);
  sleep(PAUSE_SECONDS);
}

export function admitContested() {
  ensureLoggedIn();
  // Every contender takes every contested attendee (per-vu-iterations), and all of them wait for the
  // same wall-clock slot, so the requests for one attendee genuinely overlap.
  const i = exec.vu.iterationInScenario;
  const wait =
    exec.scenario.startTime +
    CONTEST_START_MS +
    i * CONTEST_SLOT_MS -
    Date.now();
  if (wait > 0) sleep(wait / 1000);
  checkIn(seed.contested[i], i, ["VALID", "ALREADY_CHECKED_IN"]);
}

function metric(data, name, key) {
  return data.metrics[name]?.values[key] ?? null;
}

const fmt = (v) => (v === null ? "n/a" : v.toFixed(1));

function latency(data, name) {
  const key = "http_req_duration{name:" + name + "}";
  return (
    fmt(metric(data, key, "p(95)")) + " / " + fmt(metric(data, key, "p(99)"))
  );
}

export function handleSummary(data) {
  const rows = [
    ["admit requests", metric(data, "http_reqs{name:admit}", "count")],
    ["scan requests", metric(data, "http_reqs{name:scan}", "count")],
    [
      "throughput (check-in req/s)",
      fmt(
        (metric(data, "http_reqs{name:admit}", "rate") ?? 0) +
          (metric(data, "http_reqs{name:scan}", "rate") ?? 0),
      ),
    ],
    [
      "http error rate",
      `${((metric(data, "http_req_failed", "rate") ?? 0) * 100).toFixed(2)}%`,
    ],
    ["admit p95 / p99 (ms)", latency(data, "admit")],
    ["scan p95 / p99 (ms)", latency(data, "scan")],
    ["admitted (VALID)", metric(data, "admit_valid", "count") ?? 0],
    [
      "rejected as already checked in",
      metric(data, "admit_already_checked_in", "count") ?? 0,
    ],
    [
      "unexpected status",
      metric(data, "admit_unexpected_status", "count") ?? 0,
    ],
  ];
  const md = [
    "### k6: check-in admit and scan under load",
    "",
    "| Metric | Value |",
    "|---|---|",
  ]
    .concat(rows.map(([k, v]) => `| ${k} | ${v} |`))
    .join("\n");
  return {
    "k6-summary.md": `${md}\n`,
    "k6-summary.json": JSON.stringify(data),
  };
}
