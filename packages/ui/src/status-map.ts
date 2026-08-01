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
  registered: { variant: "neutral", label: "Registered" },
  confirmed: { variant: "confirmed", label: "Confirmed" },
  cancelled: { variant: "error", label: "Cancelled" },
  queued: { variant: "warn", label: "Pending" },
  // ADR 0007 accepted_only: SMTP/Graph handoff is operator-visible success.
  accepted: { variant: "ok", label: "Sent" },
  pending: { variant: "warn", label: "Pending" },
  sent: { variant: "ok", label: "Sent" },
  delivered: { variant: "ok", label: "Sent" },
  failed: { variant: "error", label: "Failed" },
  rejected: { variant: "error", label: "Failed" },
  bounced: { variant: "error", label: "Bounced" },
  active: { variant: "info", label: "Active" },
  voided: { variant: "neutral", label: "Voided" },
  expired: { variant: "neutral", label: "Expired" },
  VALID: { variant: "ok", label: "Valid" },
  ALREADY_CHECKED_IN: { variant: "warn", label: "Already checked in" },
  INVALID: { variant: "error", label: "Invalid" },
  REVOKED: { variant: "error", label: "Revoked" },
  UNKNOWN_EVENT: { variant: "neutral", label: "Unknown event" },
  NETWORK_ERROR: { variant: "neutral", label: "Network error" },
  admitted: { variant: "ok", label: "Checked in" },
  not_admitted: { variant: "neutral", label: "Not checked in" },
};

export function resolveStatusMeta(status: string): StatusMeta {
  return Object.getOwnPropertyDescriptor(STATUS_MAP, status)?.value ?? {
    variant: "neutral",
    label: status,
  };
}

/** SSR-friendly badge class for ticket pages. */
export function statusBadgeClass(status: string): string {
  const meta = resolveStatusMeta(status);
  return `at-badge at-badge--${meta.variant}${meta.dot ? " at-badge--dot" : ""}`;
}

export function statusLabel(status: string): string {
  return resolveStatusMeta(status).label;
}
