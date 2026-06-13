/** Redact email for logs: `a***@example.com`. */
export function redactEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.slice(0, 1);
  return `${visible}***${domain}`;
}

export interface LoginAuditContext {
  email: string;
  ip?: string;
  userAgent?: string;
}

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
