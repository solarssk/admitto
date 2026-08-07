import { describe, expect, it } from "vitest";
import { WORKER_LOCK_KEYS } from "../src/commands/worker-locks.js";

describe("WORKER_LOCK_KEYS", () => {
  it("exposes stable per-job lock names", () => {
    expect(WORKER_LOCK_KEYS.bounce).toBe("admitto:worker:bounce");
    expect(WORKER_LOCK_KEYS.retention).toBe("admitto:worker:retention");
    expect(WORKER_LOCK_KEYS.mail_delivery).toBe("admitto:worker:mail_delivery");
    expect(WORKER_LOCK_KEYS.import).toBe("admitto:worker:import");
    expect(WORKER_LOCK_KEYS.export).toBe("admitto:worker:export");
  });
});
