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
    const { ImapFlow } = await import("imapflow");
    const { ImapInboundProvider } = await import("../../src/bounceIngest/imapProvider.js");
    const provider = new ImapInboundProvider({
      host: "mail.example.com",
      port: 993,
      user: "bounce@example.com",
      password: "secret",
    });

    await expect(provider.connect()).resolves.toBeUndefined();
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(ImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "93.184.216.34",
        servername: "mail.example.com",
        port: 993,
        secure: true,
      }),
    );
  });

  it("fetch/markSeen/probeFolder/close work against a connected mock client", async () => {
    const release = vi.fn();
    const logout = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const messageFlagsAdd = vi.fn().mockResolvedValue(undefined);
    const search = vi.fn().mockResolvedValue([10, 11]);
    const source = Buffer.from(
      [
        'Content-Type: text/plain; charset="us-ascii"',
        "",
        "user@example.com failed: host mx.example.com said: 550 5.1.1 User unknown",
      ].join("\r\n"),
    );
    async function* fetchGen() {
      yield {
        uid: 10,
        envelope: { subject: "Undeliverable", date: new Date("2026-08-01T00:00:00Z") },
        internalDate: new Date("2026-08-01T01:00:00Z"),
        source,
      };
      yield {
        uid: 11,
        envelope: { subject: "Other" },
        source: Buffer.from("hello"),
      };
    }
    const fetch = vi.fn().mockReturnValue(fetchGen());
    const getMailboxLock = vi.fn().mockResolvedValue({ release });

    const { ImapFlow } = await import("imapflow");
    vi.mocked(ImapFlow).mockImplementationOnce(function MockClient() {
      return {
        connect: connectMock,
        getMailboxLock,
        search,
        fetch,
        messageFlagsAdd,
        logout,
        close,
      };
    } as never);

    const { ImapInboundProvider } = await import("../../src/bounceIngest/imapProvider.js");
    const provider = new ImapInboundProvider({
      host: "mail.example.com",
      port: 993,
      user: "bounce@example.com",
      password: "secret",
    });
    await provider.connect();

    const messages = await provider.fetchCandidateMessages("INBOX", new Date("2026-07-01"));
    expect(messages).toHaveLength(2);
    expect(messages[0]?.uid).toBe("10");
    expect(messages[0]?.subject).toBe("Undeliverable");
    expect(messages[0]?.bodyText).toContain("550 5.1.1");
    expect(release).toHaveBeenCalled();

    search.mockResolvedValueOnce([]);
    expect(await provider.fetchCandidateMessages("INBOX", new Date())).toEqual([]);

    await provider.markSeen("INBOX", "10");
    expect(messageFlagsAdd).toHaveBeenCalledWith("10", ["\\Seen"], { uid: true });

    await provider.probeFolder("Junk Email");
    expect(getMailboxLock).toHaveBeenCalledWith("Junk Email");

    await provider.close();
    expect(logout).toHaveBeenCalled();

    await expect(provider.fetchCandidateMessages("INBOX", new Date())).rejects.toThrow(
      /not connected/i,
    );
  });

  it("close falls back to client.close when logout throws", async () => {
    const logout = vi.fn().mockRejectedValue(new Error("already gone"));
    const close = vi.fn();
    const { ImapFlow } = await import("imapflow");
    vi.mocked(ImapFlow).mockImplementationOnce(function MockClient() {
      return { connect: connectMock, logout, close };
    } as never);

    const { ImapInboundProvider } = await import("../../src/bounceIngest/imapProvider.js");
    const provider = new ImapInboundProvider({
      host: "mail.example.com",
      port: 993,
      user: "bounce@example.com",
      password: "secret",
    });
    await provider.connect();
    await provider.close();
    expect(close).toHaveBeenCalled();
    await provider.close(); // no-op when already closed
  });
});

describe("extractPlainTextFromSource", () => {
  it("returns empty string for empty/undefined source", async () => {
    const { extractPlainTextFromSource } = await import("../../src/bounceIngest/imapProvider.js");
    expect(extractPlainTextFromSource(undefined)).toBe("");
    expect(extractPlainTextFromSource("")).toBe("");
  });

  it("decodes a base64 text/plain part", async () => {
    const { extractPlainTextFromSource } = await import("../../src/bounceIngest/imapProvider.js");
    const plain = "user@example.com failed: host mx.example.com said: 550 5.1.1 User unknown";
    const b64 = Buffer.from(plain, "utf8").toString("base64");
    const source = [
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64,
    ].join("\r\n");
    const text = extractPlainTextFromSource(source);
    expect(text).toContain("user@example.com failed:");
    expect(text).toContain("550 5.1.1");
  });

  it("decodes a text/html MIME part and strips tags", async () => {
    const { extractPlainTextFromSource } = await import("../../src/bounceIngest/imapProvider.js");
    const source = [
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="us-ascii"',
      "",
      "<html><body><p>nobody@example.org failed: host mx.example.com said: 550 5.1.1</p></body></html>",
    ].join("\r\n");
    const text = extractPlainTextFromSource(source);
    expect(text).toContain("nobody@example.org failed:");
    expect(text).not.toContain("<p>");
  });

  it("decodes HTML entities from an HTML-only body", async () => {
    const { extractPlainTextFromSource } = await import("../../src/bounceIngest/imapProvider.js");
    const mime = [
      "Content-Type: text/html; charset=utf-8",
      "",
      "<html><body><p>user@example.com failed: host mx.example.com said: 550 5.1.1 User&amp; unknown</p></body></html>",
    ].join("\r\n");

    const text = extractPlainTextFromSource(mime);
    expect(text).toContain("User& unknown");
    expect(text).not.toContain("&amp;");
  });

  it("stops walking MIME parts deeper than 5 levels", async () => {
    const { extractPlainTextFromSource } = await import("../../src/bounceIngest/imapProvider.js");
    // Nest multipart wrappers past the depth cap so the leaf is never reached.
    let inner = [
      'Content-Type: text/plain; charset="us-ascii"',
      "",
      "deep-secret@example.org failed: host mx.example.com said: 550 5.1.1 User unknown",
    ].join("\r\n");
    for (let d = 0; d < 7; d++) {
      const boundary = `B${d}`;
      inner = [
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        inner,
        `--${boundary}--`,
      ].join("\r\n");
    }
    const text = extractPlainTextFromSource(inner);
    // Depth cap yields no MIME leaves, so extract falls back to the raw body blob
    // (multipart wrappers still visible) rather than a clean single-line leaf.
    expect(text).toContain('boundary="B0"');
    expect(text).not.toBe(
      "deep-secret@example.org failed: host mx.example.com said: 550 5.1.1 User unknown",
    );
  });
});
