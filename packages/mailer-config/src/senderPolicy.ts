import type { MailerConfig } from "@admitto/mailer";

export function normalizeAllowedFromDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, "");
}

export function emailDomain(email: string): string | undefined {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return undefined;
  return trimmed.slice(at + 1).toLowerCase();
}

/** Effective visible sender used for allowed-from-domain policy checks. */
export function effectiveFromAddressForPolicy(config: MailerConfig): string | undefined {
  if (config.provider === "graph") {
    return config.fromAddress ?? config.mailbox;
  }
  return config.fromAddress;
}

export function enforceAllowedFromDomain(
  allowedDomain: string | null | undefined,
  config: MailerConfig,
): void {
  const raw = allowedDomain?.trim();
  if (!raw) return;

  const allowed = normalizeAllowedFromDomain(raw);
  const from = effectiveFromAddressForPolicy(config)?.trim();
  if (!from) {
    throw new Error("allowed_from_domain requires a configured from address or mailbox");
  }

  const fromDomain = emailDomain(from);
  if (!fromDomain || fromDomain !== allowed) {
    throw new Error(`from address domain must match allowed from domain (${allowed})`);
  }
}
