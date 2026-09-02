/** Shared shape for the Mail reports aggregate response, so the backend's reports route
 * (apps/web) and the admin frontend's own API types (apps/admin) don't carry two
 * independently-maintained copies of the same fields - same reason as eventWalletReportsDto.ts.
 * Dependency-free, so it's safe in the browser bundle. Every number here comes from EmailDelivery
 * rows the mail-delivery pipeline already writes; no new provider calls. */
export interface EventMailReportsResponse {
  total_attendees: number;
  /** Every EmailDelivery row for the event, regardless of purpose - a resend creates a new row,
   * so this counts delivery ATTEMPTS, not attendees or "emails really sent". */
  delivery: {
    total_attempts: number;
    successful: number;
    successful_pct: number;
    /** Only statuses with at least one row, in no particular order - the frontend owns the
     * canonical status order/labels/colors (same convention as EventReportsResponse.by_rsvp_status). */
    by_status: Array<{ status: string; count: number }>;
  };
  /** Grouped by attendee, not by delivery row - eliminates the resend double-count a raw
   * delivery-status breakdown would show. An attendee whose initial delivery bounced and whose
   * resend then succeeded reads as "reached" here, exactly once. */
  attendee_reach: {
    reached: number;
    not_reached: number;
    reached_pct: number;
  };
  by_purpose: {
    initial: number;
    resend: number;
  };
  /** Keyed by the template's label snapshot (template_label_snapshot), not template_id - a
   * deleted or renamed template still shows under the label it actually had when the email was
   * sent. `template: null` covers the built-in ticket template (no custom MailTemplate row). */
  by_template: Array<{
    template: string | null;
    total: number;
    successful: number;
    successful_pct: number;
  }>;
  /** Per-day count of successful deliveries, bucketed by whichever of EmailDelivery.accepted_at,
   * sent_at, or delivered_at is set first (mirrors earliestDeliverySuccessAt's own precedence in
   * reports-routes.ts - "accepted" is the only status any configured mailer adapter actually
   * reports today, so sent_at/delivered_at only ever apply once a future pipeline stage sets
   * them), in the event's own timezone, ascending, with a running total - same shape/zero-fill
   * convention as EventWalletReportsResponse.issued_by_day. Restricted to rows whose *current*
   * status is still a success status, so a delivery that was accepted and later hard-bounced
   * (which does not clear accepted_at) doesn't count here. */
  sent_by_day: Array<{ date: string; count: number; cumulative: number }>;
  /** Of the attendees email actually reached (attendee_reach.reached), how many went on to open
   * the public ticket page at least once (EmailDelivery.viewed_at) - a real engagement signal
   * that's already populated today, unlike email-open-pixel tracking (opened_at/clicked_at stay
   * unused - no such tracking mechanism exists in this codebase). */
  ticket_viewed: {
    reached: number;
    viewed: number;
    viewed_pct: number;
  };
}
