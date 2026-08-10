import { emitAuditEvent, fingerprint } from "../audit.js";

export type CfAccessLogOutcome = "success" | "failure";

/** Structured CF Access auth log - never includes raw JWT or full claims. Full email (not
 * redacted): verified staff sign-in, matching logLoginSuccess's stdout convention (failed
 * local logins still redact the operational emit). */
export function logCfAccessAuth(input: {
  outcome: CfAccessLogOutcome;
  reason?: string;
  email?: string;
  subject?: string;
  path: string;
}): void {
  emitAuditEvent("auth.cf_access", {
    outcome: input.outcome,
    provider: "cloudflare-access",
    reason: input.reason ?? null,
    email: input.email ?? null,
    subject_fingerprint: input.subject ? fingerprint(input.subject) : null,
    path: input.path,
  });
}
