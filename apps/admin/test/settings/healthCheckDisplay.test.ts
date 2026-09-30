import { describe, expect, it } from "vitest";
import {
  formatHealthDisplayLabel,
  formatHealthDisplayValue,
  healthDetailRows,
  visibleHealthDetails,
  workerLastSeen,
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
    expect(formatHealthDisplayLabel("worker_host_name")).toBe("Worker host name");
  });

  it("labels stale_after_ms without a unit, since its value is shown in minutes", () => {
    expect(formatHealthDisplayLabel("stale_after_ms")).toBe("Stale after");
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
    ["not_a_directory", "Not a folder"],
    ["not_writable", "Not writable"],
    ["missing_directory", "Missing folder"],
    ["cannot_create_directory", "Cannot create the folder"],
    ["mail_secret_decryption_failed", "Could not decrypt the stored mail secret"],
  ])("gives reason=%s the sentence %j", (code, sentence) => {
    expect(formatHealthDisplayValue("reason", code, TZ)).toBe(sentence);
  });

  it("humanizes an unrecognised reason code instead of showing it raw", () => {
    expect(formatHealthDisplayValue("reason", "some_new_code", TZ)).toBe("Some new code");
  });

  it.each([
    ["__proto__", "  proto  "],
    ["constructor", "Constructor"],
    ["toString", "ToString"],
    ["hasOwnProperty", "HasOwnProperty"],
  ])(
    "falls through reason=%s to the plain humanized string, not an inherited Object property",
    (code, expected) => {
      // A plain object literal's ["__proto__"]/["constructor"]/etc. returns a real (truthy)
      // built-in instead of undefined, which would bypass the humanizeUnknownCode fallback
      // entirely and return a non-string - this only passes because the lookup is a Map.
      expect(formatHealthDisplayValue("reason", code, TZ)).toBe(expected);
    },
  );

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
    const keys = visibleHealthDetails(check, TZ).map((d) => d.key);
    expect(keys).toEqual(["latency_ms"]);
  });

  it("keeps last_beat_at, so healthDetailRows can word it", () => {
    const check = checkRow({
      id: "background_worker",
      details: [{ key: "last_beat_at", value: "2026-08-03T12:00:00.000Z" }],
    });
    expect(visibleHealthDetails(check, TZ)).toEqual([
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
    const keys = visibleHealthDetails(check, TZ).map((d) => d.key);
    expect(keys).toEqual(["mode"]);
  });

  it("keeps a detail whose formatted value does not appear in the summary", () => {
    const check = checkRow({
      summary: "Connected",
      details: [{ key: "latency_ms", value: "4" }],
    });
    expect(visibleHealthDetails(check, TZ)).toEqual([{ key: "latency_ms", value: "4" }]);
  });

  it("does not treat a value that is only part of a longer word or number as already shown", () => {
    // "No" sits inside "Not configured", and "12" inside "112 ms": neither is a repeat.
    const notConfigured = checkRow({
      summary: "Not configured",
      details: [{ key: "configured", value: "no" }],
    });
    expect(visibleHealthDetails(notConfigured, TZ)).toEqual([{ key: "configured", value: "no" }]);
    const latency = checkRow({
      summary: "Responding slowly · 112 ms",
      details: [{ key: "latency_ms", value: "12" }],
    });
    expect(visibleHealthDetails(latency, TZ)).toEqual([{ key: "latency_ms", value: "12" }]);
  });

  it("keeps a detail with an empty value instead of treating it as a duplicate of everything", () => {
    // An unset worker hostname is emitted as `beat.hostname ?? ""` - an empty string is a
    // substring of every string, so without a guard this would look like it duplicates any
    // summary and silently disappear instead of showing blank.
    const check = checkRow({
      id: "background_worker",
      summary: "Worker heartbeat is fresh",
      details: [{ key: "hostname", value: "" }],
    });
    expect(visibleHealthDetails(check, TZ)).toEqual([{ key: "hostname", value: "" }]);
  });
});

describe("visibleHealthDetails for Wallet passes", () => {
  it("keeps every event count even when a number matches the summary", () => {
    const check = checkRow({
      id: "wallet_passes",
      summary: "Configured for 1 event",
      details: [
        { key: "status", value: "ok" },
        { key: "wallet_enabled_events", value: "1" },
        { key: "configured_events", value: "1" },
        { key: "wallet_incomplete_events", value: "0" },
        { key: "last_checked", value: "2026-08-03T12:00:00.000Z" },
      ],
    });
    expect(healthDetailRows(check, TZ, "2026-08-03T12:54:24.000Z")).toEqual([
      { key: "wallet_enabled_events", label: "Events with Wallet on", value: "1" },
      { key: "configured_events", label: "Events fully set up", value: "1" },
      { key: "wallet_incomplete_events", label: "Events not fully set up", value: "0" },
    ]);
  });
});

describe("workerLastSeen", () => {
  const generatedAt = "2026-08-03T12:54:24.000Z";

  it("returns null when there is no last_beat_at detail", () => {
    expect(workerLastSeen(checkRow({ id: "background_worker" }), generatedAt)).toBeNull();
  });

  it("returns null for a check other than background_worker, even with a last_beat_at detail", () => {
    const check = checkRow({
      id: "some_other_check",
      details: [{ key: "last_beat_at", value: "2026-08-03T12:42:24.000Z" }],
    });
    expect(workerLastSeen(check, generatedAt)).toBeNull();
  });

  it("returns null when the heartbeat is under a minute old", () => {
    const check = checkRow({
      id: "background_worker",
      details: [{ key: "last_beat_at", value: "2026-08-03T12:54:00.000Z" }],
    });
    expect(workerLastSeen(check, generatedAt)).toBeNull();
  });

  it("returns null for an invalid last_beat_at", () => {
    const check = checkRow({
      id: "background_worker",
      details: [{ key: "last_beat_at", value: "not-a-date" }],
    });
    expect(workerLastSeen(check, generatedAt)).toBeNull();
  });

  it("reports the age before the report when a minute or older", () => {
    const check = checkRow({
      id: "background_worker",
      details: [{ key: "last_beat_at", value: "2026-08-03T12:42:24.000Z" }],
    });
    expect(workerLastSeen(check, generatedAt)).toBe("12 min before this report");
  });
});

describe("healthDetailRows", () => {
  const generatedAt = "2026-08-03T12:54:24.000Z";

  it("words the worker's last_beat_at as Last seen, in place, when the age is a minute or more", () => {
    const check = checkRow({
      id: "background_worker",
      details: [
        { key: "reason", value: "stale" },
        { key: "last_beat_at", value: "2026-08-03T12:42:24.000Z" },
        { key: "hostname", value: "worker-1" },
      ],
    });
    expect(healthDetailRows(check, TZ, generatedAt)).toEqual([
      { key: "reason", label: "Reason", value: "Stale" },
      { key: "last_beat_at", label: "Last seen", value: "12 min before this report" },
      { key: "hostname", label: "Hostname", value: "worker-1" },
    ]);
  });

  it("falls back to the plain date-time when the heartbeat is under a minute old", () => {
    const iso = "2026-08-03T12:54:00.000Z";
    const check = checkRow({ id: "background_worker", details: [{ key: "last_beat_at", value: iso }] });
    expect(healthDetailRows(check, TZ, generatedAt)).toEqual([
      { key: "last_beat_at", label: "Last beat at", value: formatEventDateTime(iso, TZ) },
    ]);
  });
});
