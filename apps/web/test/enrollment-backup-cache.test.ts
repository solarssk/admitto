import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MFA_PENDING_SESSION_TTL_MS } from "@admitto/auth/constants";
import {
  clearEnrollmentBackupCacheForTests,
  getStashedEnrollmentBackupCodes,
  stashEnrollmentBackupCodes,
  submittedCodesMatchStashedEnrollmentBackup,
} from "../src/auth/enrollment-backup-cache.js";

describe("enrollment-backup-cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearEnrollmentBackupCacheForTests();
  });

  afterEach(() => {
    clearEnrollmentBackupCacheForTests();
    vi.useRealTimers();
  });

  it("expires stashed codes when TTL elapses without further MFA traffic", () => {
    stashEnrollmentBackupCodes("sess-1", ["AAAA-BBBB-CCCC-DDDD"]);
    expect(getStashedEnrollmentBackupCodes("sess-1")).toEqual(["AAAA-BBBB-CCCC-DDDD"]);

    vi.advanceTimersByTime(MFA_PENDING_SESSION_TTL_MS + 1);

    expect(getStashedEnrollmentBackupCodes("sess-1")).toBeUndefined();
  });

  it("reschedules expiry when the same session is re-stashed", () => {
    stashEnrollmentBackupCodes("sess-1", ["CODE-ONE"]);
    vi.advanceTimersByTime(MFA_PENDING_SESSION_TTL_MS - 1_000);
    stashEnrollmentBackupCodes("sess-1", ["CODE-TWO"]);

    vi.advanceTimersByTime(2_000);
    expect(getStashedEnrollmentBackupCodes("sess-1")).toEqual(["CODE-TWO"]);

    vi.advanceTimersByTime(MFA_PENDING_SESSION_TTL_MS);
    expect(getStashedEnrollmentBackupCodes("sess-1")).toBeUndefined();
  });

  it("matches only the current stashed enrollment backup-code set", () => {
    expect(submittedCodesMatchStashedEnrollmentBackup("missing-session", [])).toBe(false);

    stashEnrollmentBackupCodes("sess-1", ["AAAA-BBBB-CCCC-DDDD"]);
    expect(submittedCodesMatchStashedEnrollmentBackup("sess-1", ["AAAA-BBBB-CCCC-DDDD"])).toBe(
      true,
    );
    expect(submittedCodesMatchStashedEnrollmentBackup("sess-1", [])).toBe(false);
  });
});
