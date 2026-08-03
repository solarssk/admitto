import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { createMailer, sendBatch, MockAdapter, configFromEnv } from "../src/index.js";
import type { EmailProviderCapabilities, MailMessage } from "../src/types.js";
import * as mailerConfig from "../src/config.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

beforeEach(() => {
  mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as Awaited<
    ReturnType<typeof lookup>
  >);
});

const TEST_CAPABILITIES: EmailProviderCapabilities = {
  supportsAttachments: false,
  supportsCustomHeaders: false,
  supportsSentItems: false,
  supportsDeliveryEvents: false,
  supportsBounceMailbox: false,
  supportsEnvelopeFrom: false,
  supportsTestConnection: false,
  deliveryResultSemantics: "accepted_only",
};

describe("createMailer", () => {
  it("creates the correct adapter for each provider", async () => {
    const pa = await createMailer(
      {
        provider: "powerautomate",
        url: "https://example.com/flow",
        fromAddress: "a@example.com",
      },
      { fetchFn: vi.fn() as unknown as typeof fetch },
    );
    expect(pa.provider).toBe("powerautomate");

    const smtp = await createMailer({
      provider: "smtp",
      host: "smtp.example.com",
      user: "u",
      password: "p",
      fromAddress: "a@example.com",
    });
    expect(smtp.provider).toBe("smtp");

    const exp = await createMailer(
      { provider: "export_only", fromAddress: "a@example.com" },
      { exportSink: vi.fn() },
    );
    expect(exp.provider).toBe("export_only");
  });

  it("rejects Power Automate create when the webhook host resolves to a private address", async () => {
    mockedLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as Awaited<
      ReturnType<typeof lookup>
    >);
    await expect(
      createMailer(
        {
          provider: "powerautomate",
          url: "https://hooks.example.com/flow",
          fromAddress: "a@example.com",
        },
        { fetchFn: vi.fn() as unknown as typeof fetch },
      ),
    ).rejects.toMatchObject({
      name: "MailDestinationError",
      code: "mail_destination_blocked",
    });
  });

  it("throws when export_only is created without exportSink", async () => {
    await expect(
      createMailer({ provider: "export_only", fromAddress: "a@example.com" }),
    ).rejects.toThrow(/exportSink/);
  });

  it("throws on invalid config", async () => {
    await expect(
      createMailer({ provider: "powerautomate", url: "not-a-url", fromAddress: "a@example.com" }),
    ).rejects.toThrow();
    await expect(createMailer({ provider: "unknown-provider" })).rejects.toThrow();
  });

  it("throws on an exhaustive-default unknown provider from parseMailerConfig", async () => {
    vi.spyOn(mailerConfig, "parseMailerConfig").mockReturnValueOnce({
      provider: "legacy_fax",
    } as never);
    await expect(createMailer({ provider: "smtp" })).rejects.toThrow(/Unknown provider/);
  });
});

describe("configFromEnv", () => {
  it("builds powerautomate config from env", () => {
    const cfg = configFromEnv({
      EMAIL_PROVIDER: "powerautomate",
      POWER_AUTOMATE_URL: "https://example.com/flow",
      MAIL_FROM_ADDRESS: "a@example.com",
    } as NodeJS.ProcessEnv);
    expect(cfg.provider).toBe("powerautomate");
    if (cfg.provider !== "powerautomate") throw new Error("unexpected");
    expect(cfg.fromAddress).toBe("a@example.com");
    expect(cfg.url).toBe("https://example.com/flow");
  });
});

describe("sendBatch", () => {
  it("sends all messages, preserves result order, and counts accepted/failed", async () => {
    const adapter = new MockAdapter({ failOn: (m) => m.to.includes("bad") });
    const messages: MailMessage[] = [
      { to: "a@example.com", subject: "s", html: "<p>1</p>" },
      { to: "bad@example.com", subject: "s", html: "<p>2</p>" },
      { to: "c@example.com", subject: "s", html: "<p>3</p>" },
    ];
    const seen: number[] = [];
    const summary = await sendBatch(adapter, messages, {
      concurrency: 2,
      onResult: (_r, _m, i) => seen.push(i),
    });

    expect(summary.total).toBe(3);
    expect(summary.sent).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.results[1]!.status).toBe("failed");
    expect(summary.results[0]!.status).toBe("accepted");
    expect(seen.sort()).toEqual([0, 1, 2]);
    expect(adapter.sent.map((m) => m.to)).toEqual(["a@example.com", "c@example.com"]);
  });

  it("caps concurrency at MAX_BATCH_CONCURRENCY (20) even when caller passes higher value", async () => {
    let active = 0;
    let maxActive = 0;
    const adapter = {
      provider: "powerautomate" as const,
      capabilities: TEST_CAPABILITIES,
      close: async () => {},
      send: async (m: MailMessage) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { status: "accepted" as const, provider: "powerautomate" as const, idempotencyKey: m.idempotencyKey };
      },
    };
    const messages: MailMessage[] = Array.from({ length: 50 }, (_, i) => ({
      to: `u${i}@example.com`,
      subject: "s",
      html: "<p>x</p>",
    }));
    await sendBatch(adapter, messages, { concurrency: 999 });
    expect(maxActive).toBeLessThanOrEqual(20);
  });

  it("respects concurrency limit (no more than limit active at once)", async () => {
    let active = 0;
    let maxActive = 0;
    const adapter = {
      provider: "powerautomate" as const,
      capabilities: TEST_CAPABILITIES,
      close: async () => {},
      send: async (m: MailMessage) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return { status: "accepted" as const, provider: "powerautomate" as const, idempotencyKey: m.idempotencyKey };
      },
    };
    const messages: MailMessage[] = Array.from({ length: 10 }, (_, i) => ({
      to: `u${i}@example.com`,
      subject: "s",
      html: "<p>x</p>",
    }));
    await sendBatch(adapter, messages, { concurrency: 3 });
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
