import { lookup } from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.fn().mockResolvedValue(undefined);

vi.mock("imapflow", () => ({
  ImapFlow: vi.fn().mockImplementation(function ImapFlowMock() {
    return { connect: connectMock };
  }),
}));

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

describe("ImapInboundProvider.connect", () => {
  const envKey = "ALLOW_PRIVATE_MAIL_DESTINATIONS";
  let previousPrivateMailOverride: string | undefined;

  beforeEach(() => {
    // Same guard escape hatch as @admitto/mailer's own tests - a dev's local .env can set this
    // for lab SMTP, which would silently make the "rejects a private host" case below pass for
    // the wrong reason (guard bypassed, not enforced) instead of failing loudly.
    previousPrivateMailOverride = process.env[envKey];
    delete process.env[envKey];
    connectMock.mockClear();
    mockedLookup.mockReset();
    // Public host used by the "passes the guard" test - a real DNS lookup would be flaky in CI.
    mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as Awaited<
      ReturnType<typeof lookup>
    >);
  });

  afterEach(() => {
    if (previousPrivateMailOverride === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = previousPrivateMailOverride;
    }
  });

  it("rejects a private/loopback/link-local host before opening a socket (SSRF guard)", async () => {
    const { ImapInboundProvider } = await import("../../src/bounceIngest/imapProvider.js");
    const provider = new ImapInboundProvider({
      host: "127.0.0.1",
      port: 993,
      user: "bounce@example.com",
      password: "secret",
    });

    await expect(provider.connect()).rejects.toThrow(
      /private, loopback, or link-local/i,
    );
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("connects when the host passes the SSRF guard", async () => {
    const { ImapInboundProvider } = await import("../../src/bounceIngest/imapProvider.js");
    const provider = new ImapInboundProvider({
      host: "mail.example.com",
      port: 993,
      user: "bounce@example.com",
      password: "secret",
    });

    await expect(provider.connect()).resolves.toBeUndefined();
    expect(connectMock).toHaveBeenCalledTimes(1);
  });
});
