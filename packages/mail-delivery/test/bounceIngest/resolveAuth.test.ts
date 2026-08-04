import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BounceIngestSettings } from "@admitto/db";
import { decryptFromString } from "@admitto/crypto";
import { resolveMailConfig } from "@admitto/mailer-config";
import {
  BounceAuthError,
  DEFAULT_BOUNCE_FOLDERS,
  LOOKBACK_DAYS,
  lookbackSince,
  parseFolders,
  resolveImapConnectConfig,
} from "../../src/bounceIngest/resolveAuth.js";

vi.mock("@admitto/crypto", () => ({
  decryptFromString: vi.fn(),
}));

vi.mock("@admitto/mailer-config", () => ({
  resolveMailConfig: vi.fn(),
}));

function settings(partial: Partial<BounceIngestSettings> = {}): BounceIngestSettings {
  return {
    id: "bis_1",
    event_id: "evt_1",
    imap_host: "imap.example.com",
    imap_port: 993,
    imap_username: "bounce@example.com",
    imap_password_enc: "enc-blob",
    reuse_smtp_credentials: false,
    folders: ["INBOX"],
    poll_interval_minutes: 5,
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...partial,
  };
}

describe("parseFolders", () => {
  it("keeps a non-empty string array and filters blanks/non-strings", () => {
    expect(parseFolders(["INBOX", "  Junk Email  ", "", 12 as never, null as never])).toEqual([
      "INBOX",
      "Junk Email",
    ]);
  });

  it("falls back to defaults for an empty array", () => {
    expect(parseFolders([])).toEqual([...DEFAULT_BOUNCE_FOLDERS]);
  });

  it("parses a CSV string", () => {
    expect(parseFolders("INBOX, Junk Email, Spam")).toEqual(["INBOX", "Junk Email", "Spam"]);
  });

  it("falls back to defaults for blank/unknown values", () => {
    expect(parseFolders("   ")).toEqual([...DEFAULT_BOUNCE_FOLDERS]);
    expect(parseFolders(null)).toEqual([...DEFAULT_BOUNCE_FOLDERS]);
    expect(parseFolders(undefined)).toEqual([...DEFAULT_BOUNCE_FOLDERS]);
    expect(parseFolders(42)).toEqual([...DEFAULT_BOUNCE_FOLDERS]);
  });
});

describe("lookbackSince", () => {
  it("is exactly LOOKBACK_DAYS before the given now", () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    const since = lookbackSince(now);
    expect(since.toISOString()).toBe(
      new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    );
  });
});

describe("resolveImapConnectConfig", () => {
  const db = {} as never;

  beforeEach(() => {
    vi.mocked(decryptFromString).mockReset();
    vi.mocked(resolveMailConfig).mockReset();
  });

  it("rejects a missing host", async () => {
    await expect(
      resolveImapConnectConfig(db, settings({ imap_host: null })),
    ).rejects.toBeInstanceOf(BounceAuthError);
    await expect(
      resolveImapConnectConfig(db, settings({ imap_host: "  " })),
    ).rejects.toThrow(/IMAP host is not configured/);
  });

  it("rejects an invalid port", async () => {
    await expect(
      resolveImapConnectConfig(db, settings({ imap_port: 0 })),
    ).rejects.toThrow(/IMAP port is invalid/);
    await expect(
      resolveImapConnectConfig(db, settings({ imap_port: 70000 })),
    ).rejects.toThrow(/IMAP port is invalid/);
    await expect(
      resolveImapConnectConfig(db, settings({ imap_port: 1.5 as never })),
    ).rejects.toThrow(/IMAP port is invalid/);
  });

  it("resolves dedicated IMAP credentials", async () => {
    vi.mocked(decryptFromString).mockReturnValue("s3cret");
    const cfg = await resolveImapConnectConfig(db, settings());
    expect(cfg).toEqual({
      host: "imap.example.com",
      port: 993,
      user: "bounce@example.com",
      password: "s3cret",
    });
    expect(decryptFromString).toHaveBeenCalledWith("enc-blob");
  });

  it("rejects dedicated auth when username or password is missing", async () => {
    await expect(
      resolveImapConnectConfig(db, settings({ imap_username: null })),
    ).rejects.toThrow(/IMAP username is not configured/);
    await expect(
      resolveImapConnectConfig(db, settings({ imap_password_enc: null })),
    ).rejects.toThrow(/IMAP password is not set/);
  });

  it("wraps decrypt failures", async () => {
    vi.mocked(decryptFromString).mockImplementation(() => {
      throw new Error("bad key");
    });
    await expect(resolveImapConnectConfig(db, settings())).rejects.toThrow(
      /Cannot decrypt IMAP password: bad key/,
    );
  });

  it("reuses SMTP credentials when requested", async () => {
    vi.mocked(resolveMailConfig).mockResolvedValue({
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      user: "smtp-user",
      password: "smtp-pass",
      fromAddress: "from@example.com",
    } as never);

    const cfg = await resolveImapConnectConfig(
      db,
      settings({ reuse_smtp_credentials: true, imap_username: null, imap_password_enc: null }),
    );
    expect(cfg).toEqual({
      host: "imap.example.com",
      port: 993,
      user: "smtp-user",
      password: "smtp-pass",
    });
  });

  it("rejects reuse when resolveMailConfig throws", async () => {
    vi.mocked(resolveMailConfig).mockRejectedValue(new Error("no mail config"));
    await expect(
      resolveImapConnectConfig(db, settings({ reuse_smtp_credentials: true })),
    ).rejects.toThrow(/Cannot reuse SMTP credentials: no mail config/);
  });

  it("rejects reuse when effective provider is not SMTP", async () => {
    vi.mocked(resolveMailConfig).mockResolvedValue({
      provider: "graph",
      mailbox: "events@example.com",
      fromAddress: "events@example.com",
    } as never);
    await expect(
      resolveImapConnectConfig(db, settings({ reuse_smtp_credentials: true })),
    ).rejects.toThrow(/only available when this event's mail transport is SMTP/);
  });
});
