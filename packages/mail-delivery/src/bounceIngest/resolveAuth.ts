import { decryptFromString } from "@admitto/crypto";
import type { PrismaClient, BounceIngestSettings } from "@admitto/db";
import { resolveMailConfig } from "@admitto/mailer-config";
import type { ImapConnectConfig } from "./types.js";

export const DEFAULT_BOUNCE_FOLDERS = ["INBOX", "Junk Email"] as const;
export const LOOKBACK_DAYS = 14;

export function parseFolders(folders: unknown): string[] {
  if (Array.isArray(folders)) {
    const list = folders
      .filter((f): f is string => typeof f === "string")
      .map((f) => f.trim())
      .filter(Boolean);
    return list.length > 0 ? list : [...DEFAULT_BOUNCE_FOLDERS];
  }
  if (typeof folders === "string" && folders.trim()) {
    const list = folders
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    return list.length > 0 ? list : [...DEFAULT_BOUNCE_FOLDERS];
  }
  return [...DEFAULT_BOUNCE_FOLDERS];
}

export function lookbackSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Cutoff for deleting processed UID markers.
 *
 * IMAP `SEARCH SINCE` is day-granular on many servers (same caveat as bounce
 * probe). Pruning at the exact `lookbackSince()` timestamp can drop markers
 * from earlier on the boundary calendar day that the same run's search still
 * returns. Keep the whole UTC day of `since`.
 */
export function uidRetentionCutoff(since: Date): Date {
  return new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
}

export class BounceAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BounceAuthError";
  }
}

/**
 * Resolve IMAP host/port always from BounceIngestSettings.
 * Username/password: either dedicated IMAP secret, or effective SMTP auth when
 * reuse_smtp_credentials is set and the event's resolved provider is SMTP.
 */
export async function resolveImapConnectConfig(
  db: PrismaClient,
  settings: BounceIngestSettings,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ImapConnectConfig> {
  const host = settings.imap_host?.trim();
  const port = settings.imap_port ?? 993;
  if (!host) {
    throw new BounceAuthError("IMAP host is not configured");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new BounceAuthError("IMAP port is invalid");
  }

  if (settings.reuse_smtp_credentials) {
    let mail;
    try {
      mail = await resolveMailConfig(settings.event_id, db, env);
    } catch (err) {
      throw new BounceAuthError(
        `Cannot reuse SMTP credentials: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (mail.provider !== "smtp") {
      throw new BounceAuthError(
        "Use SMTP username & password is only available when this event's mail transport is SMTP",
      );
    }
    return {
      host,
      port,
      user: mail.user,
      password: mail.password,
    };
  }

  const user = settings.imap_username?.trim();
  if (!user) {
    throw new BounceAuthError("IMAP username is not configured");
  }
  if (!settings.imap_password_enc) {
    throw new BounceAuthError("IMAP password is not set");
  }
  let password: string;
  try {
    password = decryptFromString(settings.imap_password_enc);
  } catch (err) {
    throw new BounceAuthError(
      `Cannot decrypt IMAP password: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { host, port, user, password };
}
