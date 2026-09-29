import { describe, expect, it } from "vitest";
import {
  formatHealthDisplayLabel,
  formatHealthDisplayValue,
  visibleHealthDetails,
  workerLastSeenFact,
} from "../../src/settings/healthCheckDisplay.js";
import { formatEventDateTime } from "../../src/utils/event-dates.js";
import type { HealthCheckRowDto } from "../../src/api/types.js";

const TZ = "Europe/Warsaw";

function checkRow(overrides: Partial<HealthCheckRowDto> = {}): HealthCheckRowDto {
  return {
    id: "test_check",
    label: "Test check",
    status: "ok",
    summary: "Connected",
    details: [],
    ...overrides,
  };
}

describe("formatHealthDisplayLabel", () => {
  it("keeps the existing mapped label unchanged", () => {
    expect(formatHealthDisplayLabel("latency_ms")).toBe("Latency");
  });

  it("sentence-cases an unmapped key instead of title-casing every word", () => {
    expect(formatHealthDisplayLabel("stale_after_ms")).toBe("Stale after ms");
  });

  it("capitalises a single-word unmapped key", () => {
    expect(formatHealthDisplayLabel("hostname")).toBe("Hostname");
  });
});

describe("formatHealthDisplayValue", () => {
  it("converts stale_after_ms to minutes", () => {
    expect(formatHealthDisplayValue("stale_after_ms", "300000", TZ)).toBe("5 min");
  });

  it("leaves a non-numeric stale_after_ms unchanged", () => {
    expect(formatHealthDisplayValue("stale_after_ms", "not-a-number", TZ)).toBe("not-a-number");
  });

  it.each([
    ["lookup_failed", "Status could not be read"],
    ["never_ran", "Never ran"],
    ["stale", "Stale"],
    ["not_implemented", "Not implemented"],
    ["unknown_provider", "Unknown provider"],
    ["write_probe_failed", "Write test did not pass"],
    ["mail_secret_decryption_failed", "Could not decrypt the stored mail secret"],
  ])("gives reason=%s the sentence %j", (code, sentence) => {
    expect(formatHealthDisplayValue("reason", code, TZ)).toBe(sentence);
  });

  it("humanizes an unrecognised reason code instead of showing it raw", () => {
    expect(formatHealthDisplayValue("reason", "some_new_code", TZ)).toBe("Some new code");
  });

  it.each([
    ["ok", "Passed"],
    ["failed", "Did not pass"],
    ["skipped", "Not tested this run"],
    ["timeout", "Timed out"],
    ["unavailable", "Provider unavailable"],
    ["support_contact_required", "Needs a support contact"],
  ])("gives live_check=%s the sentence %j", (code, sentence) => {
    expect(formatHealthDisplayValue("live_check", code, TZ)).toBe(sentence);
  });

  it("humanizes an unrecognised live_check code instead of showing it raw", () => {
    expect(formatHealthDisplayValue("live_check", "some_new_code", TZ)).toBe("Some new code");
  });

  it("formats last_beat_at as a browser-local date-time", () => {
    const iso = "2026-08-03T12:00:00.000Z";
    expect(formatHealthDisplayValue("last_beat_at", iso, TZ)).toBe(formatEventDateTime(iso, TZ));
  });

  it.each([
    ["configured", "yes", "Yes"],
    ["configured", "no", "No"],
    ["enabled", "yes", "Yes"],
    ["writable", "no", "No"],
  ])("capitalises %s=%s to %j", (key, value, expected) => {
    expect(formatHealthDisplayValue(key, value, TZ)).toBe(expected);
  });

  it("delegates anything else to the shared export formatter", () => {
    expect(formatHealthDisplayValue("latency_ms", "4", TZ)).toBe("4 ms");
  });
});

describe("visibleHealthDetails", () => {
  it("always hides status and last_checked", () => {
    const check = checkRow({
      details: [
        { key: "status", value: "ok" },
        { key: "last_checked", value: "2026-08-03T12:00:00.000Z" },
        { key: "latency_ms", value: "4" },
      ],
    });
    const keys = visibleHealthDetails(check, TZ, false).map((d) => d.key);
    expect(keys).toEqual(["latency_ms"]);
  });

  it("hides last_beat_at only when the worker fact already shows it", () => {
    const check = checkRow({
      id: "background_worker",
      details: [{ key: "last_beat_at", value: "2026-08-03T12:00:00.000Z" }],
    });
    expect(visibleHealthDetails(check, TZ, true)).toEqual([]);
    expect(visibleHealthDetails(check, TZ, false)).toEqual([
      { key: "last_beat_at", value: "2026-08-03T12:00:00.000Z" },
    ]);
  });

  it("hides a detail whose formatted value already appears in the summary", () => {
    const check = checkRow({
      summary: "Responding slowly · 200 ms",
      details: [
        { key: "mode", value: "redis" },
        { key: "latency_ms", value: "200" },
      ],
    });
    const keys = visibleHealthDetails(check, TZ, false).map((d) => d.key);
    expect(keys).toEqual(["mode"]);
  });

  it("keeps a detail whose formatted value does not appear in the summary", () => {
    const check = checkRow({
      summary: "Connected",
      details: [{ key: "latency_ms", value: "4" }],
    });
    expect(visibleHealthDetails(check, TZ, false)).toEqual([{ key: "latency_ms", value: "4" }]);
  });
});

describe("workerLastSeenFact", () => {
  const generatedAt = "2026-08-03T12:54:24.000Z";

  it("returns null when there is no last_beat_at detail", () => {
    expect(workerLastSeenFact(checkRow(), generatedAt)).toBeNull();
  });

  it("returns null when the heartbeat is under a minute old", () => {
    const check = checkRow({ details: [{ key: "last_beat_at", value: "2026-08-03T12:54:00.000Z" }] });
    expect(workerLastSeenFact(check, generatedAt)).toBeNull();
  });

  it("returns null for an invalid last_beat_at", () => {
    const check = checkRow({ details: [{ key: "last_beat_at", value: "not-a-date" }] });
    expect(workerLastSeenFact(check, generatedAt)).toBeNull();
  });

  it("reports the age before the report when a minute or older", () => {
    const check = checkRow({ details: [{ key: "last_beat_at", value: "2026-08-03T12:42:24.000Z" }] });
    expect(workerLastSeenFact(check, generatedAt)).toBe("Last seen 12 min before this report");
  });
});
