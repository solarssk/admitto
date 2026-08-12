import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import { MailConfigError } from "@admitto/mailer-config";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import {
  handleSmtpConnectionProbe,
  MAIL_PROVIDER_UNCONFIGURED,
  SMTP_PROBE_NOT_SMTP_MESSAGE,
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

describe("handleSmtpConnectionProbe", () => {
  it("returns 400 when resolveConfig reports mail as unconfigured", async () => {
    const onProbed = vi.fn();
    const res = await handleSmtpConnectionProbe(fakeContext(), {
      resolveConfig: async () => {
        throw new Error(`${MAIL_PROVIDER_UNCONFIGURED}: missing smtp`);
      },
      logPrefix: "[test] smtp probe",
      onProbed,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "mail transport not configured" });
    expect(onProbed).not.toHaveBeenCalled();
  });

  it("rethrows non-Error resolveConfig failures", async () => {
    await expect(
      handleSmtpConnectionProbe(fakeContext(), {
        resolveConfig: async () => {
          throw "resolve blew up";
        },
        logPrefix: "[test] smtp probe",
        onProbed: vi.fn(),
      }),
    ).rejects.toBe("resolve blew up");
  });

  it("rethrows other Error resolveConfig failures", async () => {
    await expect(
      handleSmtpConnectionProbe(fakeContext(), {
        resolveConfig: async () => {
          throw new Error("db down");
        },
        logPrefix: "[test] smtp probe",
        onProbed: vi.fn(),
      }),
    ).rejects.toThrow("db down");
  });

  it("returns a 422 with the stable error code when a stored mail secret cannot be decrypted", async () => {
    resetSystemLogBufferForTest();
    const onProbed = vi.fn();
    const res = await handleSmtpConnectionProbe(fakeContext(), {
      resolveConfig: async () => {
        throw new MailConfigError(
          "mail_secret_decryption_failed",
          "A stored mail secret could not be decrypted.",
        );
      },
      logPrefix: "[test] smtp probe",
      onProbed,
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: "mail_secret_decryption_failed" });
    expect(onProbed).not.toHaveBeenCalled();

    const logs = querySystemLogs();
    expect(logs.some((l) => l.message === "mail_secret_decryption_failed")).toBe(true);
  });

  it("returns 400 when the resolved provider is not SMTP", async () => {
    const onProbed = vi.fn();
    const res = await handleSmtpConnectionProbe(fakeContext(), {
      resolveConfig: async () => ({ provider: "export_only" }) as never,
      logPrefix: "[test] smtp probe",
      onProbed,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: SMTP_PROBE_NOT_SMTP_MESSAGE });
    expect(onProbed).not.toHaveBeenCalled();
  });

  it("returns the probe success payload after onProbed", async () => {
    const onProbed = vi.fn(async () => undefined);
    const res = await handleSmtpConnectionProbe(fakeContext(), {
      resolveConfig: async () =>
        ({
          provider: "smtp",
          host: "smtp.example.com",
          port: 587,
          user: "u",
          pass: "p",
          from: "from@example.com",
        }) as never,
      logPrefix: "[test] smtp probe",
      probeDeps: {
        probeMail: async () => ({ ok: true }),
      },
      onProbed,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      message: "Connected. SMTP account verified.",
    });
    expect(onProbed).toHaveBeenCalledWith({
      ok: true,
      message: "Connected. SMTP account verified.",
    });
  });

  it("returns the probe failure payload after onProbed", async () => {
    const onProbed = vi.fn(async () => undefined);
    const res = await handleSmtpConnectionProbe(fakeContext(), {
      resolveConfig: async () =>
        ({
          provider: "smtp",
          host: "smtp.example.com",
          port: 587,
          user: "u",
          pass: "p",
          from: "from@example.com",
        }) as never,
      logPrefix: "[test] smtp probe",
      probeDeps: {
        probeMail: async () => ({ ok: false, error: "auth failed" }),
      },
      onProbed,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
    expect(onProbed).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });
});
