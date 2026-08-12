import { describe, expect, it } from "vitest";
import { MailConfigError } from "@admitto/mailer-config";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import {
  MAIL_PROVIDER_UNCONFIGURED,
  MAIL_SECRET_DECRYPTION_FAILED_MESSAGE,
  runTransportTest,
} from "../../src/admin/mail-settings-shared.js";

describe("runTransportTest — stored secret cannot be decrypted", () => {
  it("returns a clear operator message instead of the raw crypto error", async () => {
    resetSystemLogBufferForTest();
    const outcome = await runTransportTest(async () => {
      throw new MailConfigError(
        "mail_secret_decryption_failed",
        "A stored mail secret could not be decrypted.",
      );
    }, "[test] mail transport test");

    expect(outcome.resultStatus).toBe("failed");
    expect(outcome.errorMessage).toBe(MAIL_SECRET_DECRYPTION_FAILED_MESSAGE);
  });

  it("logs a descriptive mail_secret_decryption_failed system log entry", async () => {
    resetSystemLogBufferForTest();
    await runTransportTest(async () => {
      throw new MailConfigError(
        "mail_secret_decryption_failed",
        "A stored mail secret could not be decrypted.",
      );
    }, "[test] mail transport test");

    const logs = querySystemLogs();
    expect(logs.some((l) => l.message === "mail_secret_decryption_failed")).toBe(true);
  });
});

describe("runTransportTest — other failure branches", () => {
  it("maps a MAIL_PROVIDER_UNCONFIGURED failure to a fixed message", async () => {
    const outcome = await runTransportTest(async () => {
      throw new Error(`${MAIL_PROVIDER_UNCONFIGURED}: missing smtp`);
    }, "[test] mail transport test");

    expect(outcome.resultStatus).toBe("failed");
    expect(outcome.errorMessage).toBe("mail transport not configured");
  });

  it("falls back to transportTestErrorForAdmin for any other error", async () => {
    const outcome = await runTransportTest(async () => {
      throw new Error("ECONNREFUSED");
    }, "[test] mail transport test");

    expect(outcome.resultStatus).toBe("failed");
    expect(outcome.errorMessage).toMatch(/connection refused/i);
  });
});
