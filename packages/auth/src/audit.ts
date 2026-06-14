/** Redact email for logs: `a***@example.com`. */
export function redactEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.slice(0, 1);
  return `${visible}***${domain}`;
}

/** Context for structured login audit events (email is redacted in logs). */
export interface LoginAuditContext {
  email: string;
  ip?: string;
  userAgent?: string;
}

/** Emit `auth.login.success` as JSON to stdout (no password/token fields). */
export function logLoginSuccess(ctx: LoginAuditContext): void {
  console.info(
    JSON.stringify({
      event: "auth.login.success",
      email: redactEmail(ctx.email),
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    }),
  );
}

/** Emit `auth.login.fail` as JSON to stdout (uniform shape for enumeration-safe failures). */
export function logLoginFailure(ctx: LoginAuditContext): void {
  console.info(
    JSON.stringify({
      event: "auth.login.fail",
      email: redactEmail(ctx.email),
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    }),
  );
}

/** Emit `auth.mfa.break_glass` audit (no codes/secrets). */
export function logMfaBreakGlass(ctx: { action: string; email: string; ip?: string }): void {
  console.info(
    JSON.stringify({
      event: "auth.mfa.break_glass",
      action: ctx.action,
      email: redactEmail(ctx.email),
      ip: ctx.ip ?? null,
    }),
  );
}
