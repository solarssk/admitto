import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { MailConfigError } from "@admitto/mailer-config";
import { MailDestinationError } from "@admitto/mailer";
import {
  mailNotConfiguredResponse,
  mailTransportSetupErrorResponse,
} from "../../src/admin/mail-settings-shared.js";

function fakeContext(): Context {
  return {
    json: (data: unknown, status?: number) =>
      new Response(JSON.stringify(data), {
        status: status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  } as unknown as Context;
}

describe("mailNotConfiguredResponse", () => {
  it("maps the unconfigured-provider message to a 422", async () => {
    const res = mailNotConfiguredResponse(fakeContext(), new Error("Cannot resolve mail provider"));
    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "mail_not_configured" });
  });

  it("returns null for unrelated errors so the caller can rethrow", () => {
    expect(mailNotConfiguredResponse(fakeContext(), new Error("db down"))).toBeNull();
  });
});

describe("mailTransportSetupErrorResponse", () => {
  it("maps MailDestinationError to a 422 with the machine-readable code", async () => {
    const err = new MailDestinationError("mail_destination_blocked", "blocked destination");
    const res = mailTransportSetupErrorResponse(fakeContext(), err);
    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "mail_destination_blocked" });
  });

  it("maps MailConfigError (undecryptable stored secret) to a 422 with its code", async () => {
    const err = new MailConfigError(
      "mail_secret_decryption_failed",
      "A stored mail secret could not be decrypted.",
    );
    const res = mailTransportSetupErrorResponse(fakeContext(), err);
    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "mail_secret_decryption_failed" });
  });

  it("returns null for unrelated errors so the caller can rethrow", () => {
    expect(mailTransportSetupErrorResponse(fakeContext(), new Error("boom"))).toBeNull();
  });
});
