// k6 load test for the check-in hot path (.github/workflows/load-test.yml).
//
// Two scenarios run at once against POST /api/checkin/admit, several operator accounts at once:
//   - distinct: each attendee is admitted exactly once (many different attendees in parallel).
//   - contested: each attendee is admitted by several operators at the same moment; exactly one
//     may win. The authoritative "no double admit" check is a database query after the run
//     (see the workflow); the k6 side counts outcomes so a mismatch is visible in the summary.
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
      executor: "shared-iterations",
      vus: CONTENDERS,
      iterations: seed.contestedIds.length * CONTENDERS,
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
  },
};

let loggedIn = false;
let failuresLogged = 0;

function ensureLoggedIn() {
  if (loggedIn) return;
  // Login is rate limited to 10 per minute per client IP, and every VU here shares one IP, so
  // stagger the first logins rather than have them all land in the same instant.
  sleep(exec.vu.idInTest * 0.5);
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

function admit(attendeeId) {
  const res = http.post(
    `${BASE_URL}/api/checkin/admit`,
    JSON.stringify({
      eventId: seed.eventId,
      attendeeId,
      method: "scan",
      deviceId: `k6-vu-${exec.vu.idInTest}`,
    }),
    {
      headers: { "Content-Type": "application/json", Origin: BASE_URL },
      tags: { name: "admit" },
    },
  );
  const ok = check(res, { "admit returned 200": (r) => r.status === 200 });
  if (!ok) {
    // Log only the first few failures per VU so a broken run is diagnosable without flooding.
    failuresLogged += 1;
    if (failuresLogged <= 3) {
      console.error(
        `admit failed: ${res.status} ${String(res.body).slice(0, 200)}`,
      );
    }
    return;
  }
  const status = res.json("status");
  if (status === "VALID") validAdmits.add(1);
  else if (status === "ALREADY_CHECKED_IN") alreadyAdmitted.add(1);
  else unexpected.add(1);
  check(res, {
    "admit status is known": () =>
      status === "VALID" || status === "ALREADY_CHECKED_IN",
  });
}

export function admitDistinct() {
  ensureLoggedIn();
  const i = exec.scenario.iterationInTest;
  if (i >= seed.distinctIds.length) {
    sleep(PAUSE_SECONDS);
    return;
  }
  admit(seed.distinctIds[i]);
  sleep(PAUSE_SECONDS);
}

export function admitContested() {
  ensureLoggedIn();
  // Consecutive iterations share an attendee, so CONTENDERS operators hit it at nearly the same time.
  const i = Math.floor(exec.scenario.iterationInTest / CONTENDERS);
  admit(seed.contestedIds[i]);
}

function metric(data, name, key) {
  const m = data.metrics[name];
  return m && m.values[key] !== undefined ? m.values[key] : null;
}

const fmt = (v) => (v === null ? "n/a" : v.toFixed(1));

export function handleSummary(data) {
  const rows = [
    ["admit requests", metric(data, "http_reqs", "count")],
    ["throughput (req/s)", fmt(metric(data, "http_reqs", "rate"))],
    [
      "http error rate",
      `${((metric(data, "http_req_failed", "rate") ?? 0) * 100).toFixed(2)}%`,
    ],
    [
      "p95 latency (ms)",
      fmt(metric(data, "http_req_duration{name:admit}", "p(95)")),
    ],
    [
      "p99 latency (ms)",
      fmt(metric(data, "http_req_duration{name:admit}", "p(99)")),
    ],
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
    "### k6: check-in admit under load",
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
