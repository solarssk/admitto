import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = readFileSync(join(HERE, "../../../web/src/admin/health-check-routes.ts"), "utf8");
const CLIENT = ["healthCheckDisplay.ts", "healthCheckGuidance.ts"]
  .map((file) => readFileSync(join(HERE, "../../src/settings", file), "utf8"))
  .join("\n");

/** Every quoted snake_case code in `text`. */
function quotedCodes(text: string): string[] {
  return [...text.matchAll(/"([a-z][a-z_]*)"/g)].map((m) => m[1]!);
}

/** Codes the server can put in a row's `reason` detail: `["reason", "x"]` entries, plus the last
 * argument of `fileStorageIssueRow(...)`, which sets its `reason` from a parameter. */
function serverReasonCodes(): Set<string> {
  const codes = new Set<string>();
  for (const m of SERVER.matchAll(/\["reason",\s*"([a-z_]+)"\]/g)) codes.add(m[1]!);
  for (const m of SERVER.matchAll(/fileStorageIssueRow\(([^)]*)\)/g)) {
    const last = quotedCodes(m[1]!).at(-1);
    if (last) codes.add(last);
  }
  return codes;
}

/** Codes the server can put in a row's `live_check` detail. */
function serverLiveCheckCodes(): Set<string> {
  const codes = new Set<string>();
  for (const m of SERVER.matchAll(/\["live_check",\s*"([a-z_]+)"\]/g)) codes.add(m[1]!);
  const weatherSet = /WEATHER_LIVE_CHECK_REASONS = new Set\(\[([^\]]*)\]/.exec(SERVER)?.[1] ?? "";
  for (const code of quotedCodes(weatherSet)) codes.add(code);
  codes.add("failed"); // weatherLiveCheckReason()'s catch-all
  return codes;
}

/** Neither `tsc` nor a behavioural test notices when the server starts emitting a reason or live
 * check code the Health check tab has no wording for: the row would still render, with a
 * humanized raw code and no guidance. This scans the server's real usages and fails on drift,
 * the same way `operator-api-error.coverage.test.ts` does for API error codes. */
describe("Health check dictionary covers what the server can emit", () => {
  it("finds the codes it is meant to scan for (guards against the scan itself rotting)", () => {
    expect(serverReasonCodes()).toEqual(
      expect.objectContaining(new Set(["never_ran", "stale", "lookup_failed", "not_a_directory", "missing_directory"])),
    );
    expect(serverLiveCheckCodes()).toEqual(expect.objectContaining(new Set(["ok", "failed", "timeout"])));
  });

  it("has a reason sentence or guidance branch for every reason code the server emits", () => {
    const known = new Set(quotedCodes(CLIENT));
    const missing = [...serverReasonCodes()].filter((code) => !known.has(code)).sort();
    expect(
      missing,
      "The server emits a `reason` code that healthCheckDisplay.ts (REASON_SENTENCES) and healthCheckGuidance.ts never mention. Add a sentence to REASON_SENTENCES, and guidance if the state is a problem.",
    ).toEqual([]);
  });

  it("has a live check sentence for every live_check code the server emits", () => {
    const known = new Set(quotedCodes(CLIENT));
    const missing = [...serverLiveCheckCodes()].filter((code) => !known.has(code)).sort();
    expect(
      missing,
      "The server emits a `live_check` code that healthCheckDisplay.ts (LIVE_CHECK_SENTENCES) and healthCheckGuidance.ts never mention. Add a sentence to LIVE_CHECK_SENTENCES.",
    ).toEqual([]);
  });
});
