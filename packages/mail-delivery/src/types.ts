export interface SendTicketEmailsResult {
  batchId: string;
  /**
   * Rows left in `queued` for the worker to drain (ADR 0042).
   * When `deliverImmediately` is set (tests / rare sync callers), equals provider accepts.
   */
  queued: number;
  /**
   * Provider accepts when `deliverImmediately` was used; otherwise 0 (worker drains later).
   * @deprecated Prefer `queued` for HTTP enqueue paths; kept for a few sync/test callers.
   */
  sent: number;
  skipped: Array<{ attendeeId: string; reason: string }>;
  deliveries: Array<{ attendeeId: string; deliveryId: string }>;
  /** The template actually resolved for this send (event override -> org override -> builtin
   * default) - undefined only when the builtin default was used, same as EmailDelivery.template_id. */
  resolvedTemplateId: string | undefined;
}
