export type BadgeVariant =
  | "neutral"
  | "primary"
  | "ok"
  | "warn"
  | "error"
  | "info"
  | "confirmed"
  | "vip";

export interface StatusMeta {
  variant: BadgeVariant;
  label: string;
  dot?: boolean;
}

/** Maps DB domain statuses to UI badge presentation (single source of truth). */
export const STATUS_MAP: Record<string, StatusMeta> = {
  registered: { variant: "neutral", label: "Registered", dot: true },
  confirmed: { variant: "confirmed", label: "Confirmed", dot: true },
  cancelled: { variant: "error", label: "Cancelled", dot: true },
  queued: { variant: "warn", label: "Pending", dot: true },
  // ADR 0007 accepted_only: SMTP/Graph handoff is operator-visible success.
  accepted: { variant: "ok", label: "Sent", dot: true },
  pending: { variant: "warn", label: "Pending", dot: true },
  sent: { variant: "ok", label: "Sent", dot: true },
  delivered: { variant: "ok", label: "Sent", dot: true },
  failed: { variant: "error", label: "Failed", dot: true },
  rejected: { variant: "error", label: "Failed", dot: true },
  bounced: { variant: "error", label: "Bounced", dot: true },
  active: { variant: "info", label: "Active", dot: true },
  voided: { variant: "neutral", label: "Voided", dot: true },
  expired: { variant: "neutral", label: "Expired", dot: true },
  VALID: { variant: "ok", label: "Valid" },
  ALREADY_CHECKED_IN: { variant: "warn", label: "Already checked in" },
  INVALID: { variant: "error", label: "Invalid" },
  REVOKED: { variant: "error", label: "Revoked" },
  UNKNOWN_EVENT: { variant: "neutral", label: "Unknown event" },
  NETWORK_ERROR: { variant: "neutral", label: "Network error" },
  admitted: { variant: "ok", label: "Checked in", dot: true },
  not_admitted: { variant: "neutral", label: "Not checked in", dot: true },
};

export function resolveStatusMeta(status: string): StatusMeta {
  return STATUS_MAP[status] ?? { variant: "neutral", label: status, dot: true };
}

/** SSR-friendly badge class for ticket pages. */
export function statusBadgeClass(status: string): string {
  const meta = resolveStatusMeta(status);
  return `at-badge at-badge--${meta.variant}${meta.dot ? " at-badge--dot" : ""}`;
}

export function statusLabel(status: string): string {
  return resolveStatusMeta(status).label;
}
