import { createHash } from "node:crypto";
import { redactEmail } from "../audit.js";

export type CfAccessLogOutcome = "success" | "failure";

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** Structured CF Access auth log — never includes raw JWT or full claims. */
export function logCfAccessAuth(input: {
  outcome: CfAccessLogOutcome;
  reason?: string;
  email?: string;
  subject?: string;
  path: string;
}): void {
  console.info(
    JSON.stringify({
      event: "auth.cf_access",
      outcome: input.outcome,
      provider: "cloudflare-access",
      reason: input.reason ?? null,
      email: input.email ? redactEmail(input.email) : null,
      subject_fingerprint: input.subject ? fingerprint(input.subject) : null,
      path: input.path,
    }),
  );
}
