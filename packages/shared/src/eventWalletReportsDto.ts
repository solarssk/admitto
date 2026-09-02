/** Shared shape for the Wallet reports aggregate response, so the backend's reports route
 * (apps/web) and the admin frontend's own API types (apps/admin) don't carry two
 * independently-maintained copies of the same fields (SonarCloud duplication flag on PR #1125,
 * same reason as DeliveryDto - see deliveryDto.ts). Dependency-free, so it's safe in the browser
 * bundle. */
export interface EventWalletReportsResponse {
  total_attendees: number;
  /** Most recent WalletPass.registration_checked_at across the event's passes - null if none has
   * ever synced. Platform/adoption numbers below reflect PassCreator state as of this sync. */
  synced_at: string | null;
  /** True once the event has more issued passes than WALLET_AGGREGATE_MAX - platform, ticket-type
   * adoption, and time-to-wallet-tap are all derived from a WALLET_AGGREGATE_MAX-row sample in
   * that case (an arbitrary sample - the underlying query has no explicit ordering, so no
   * particular bias is claimed), while issued_by_day and admission_by_wallet stay exact
   * (SQL-aggregated over every row, not sample-dependent) regardless. The frontend surfaces this
   * so a genuinely huge event doesn't show confidently-wrong percentages with no indication. */
  passes_truncated: boolean;
  adoption: {
    got_pass: number;
    got_pass_pct: number;
    confirmed: number;
    confirmed_pct: number;
  };
  /** Mutually exclusive - a pass can be actively registered on more than one platform at once
   * (the same attendee opening their ticket link on both an iPhone and an Android device, say),
   * so a naive apple-count + google-count double-counts that pass. These three always sum to
   * exactly `adoption.confirmed` - a pass with no active registration on any platform isn't a
   * "platform" at all, so it has no slice here (see the Wallets tab's own platform-split card). */
  platform: {
    apple_only: number;
    google_only: number;
    both: number;
  };
  /** How many active device/account registrations each confirmed attendee's single pass has,
   * bucketed - provider-agnostic (reads WalletPass.apple_active_registrations +
   * google_active_registrations, generic columns any WalletPassProvider populates the same way,
   * not anything PassCreator-specific). One WalletPass per attendee (attendee_id is unique), so
   * this is genuinely "how many attendees have their one pass on N devices/accounts", not a count
   * of passes. Counts only confirmed attendees (adoption.confirmed) - an attendee with zero
   * registrations isn't in any bucket here, same reasoning as `platform` above. Buckets always sum
   * to exactly `adoption.confirmed`. */
  registrations_per_attendee: {
    buckets: Array<{ key: "1" | "2" | "3" | "4_plus"; count: number; pct: number }>;
  };
  by_ticket_type: Array<{
    key: string | null;
    type: string;
    color: string;
    total: number;
    /** Issued (pass generated), regardless of install status - the CSV/PDF export's own "Got
     * pass" column. Kept alongside `confirmed` below rather than replaced by it, since the two
     * answer different questions and the export intentionally reports the issued count. */
    got_pass: number;
    pct: number;
    /** Actually installed (active on a device), i.e. the same definition as `adoption.confirmed`
     * scoped to this ticket type - what the Wallets tab's "Adoption by ticket type" card shows,
     * distinct from `got_pass` above (issued-but-not-installed passes don't count here). */
    confirmed: number;
    confirmed_pct: number;
  }>;
  /** Per-day counts in the event's own timezone, ascending, plus a running total. Extends through
   * today (or the event date, whichever is earlier) even when no pass was issued on the most
   * recent days - a chart that just stopped at the last real row would look frozen days in the
   * past instead of reading as "flat since then." Days with no pass issued still get a row here
   * (count: 0, cumulative carried forward), so the frontend doesn't need to fill gaps itself. */
  issued_by_day: Array<{ date: string; count: number; cumulative: number }>;
  time_to_wallet_tap: {
    average_days: number | null;
    buckets: Array<{ key: "same_day" | "1_3" | "4_7" | "8_plus"; count: number; pct: number }>;
  };
  /** "with_wallet" means the pass is actively registered on a device (an Apple/Google active
   * registration count > 0) - not merely issued. An attendee who got the ticket-link email but
   * never actually added the pass to a wallet app behaves like the without-wallet group for this
   * comparison's own purpose (does *having* a working pass correlate with showing up), so they're
   * counted there, matching the card's own description ("... who installed a wallet pass"). */
  admission_by_wallet: {
    with_wallet: { total: number; admitted: number; pct: number };
    without_wallet: { total: number; admitted: number; pct: number };
  };
  /** What became of every issued pass - mutually exclusive, always summing to exactly
   * `adoption.got_pass`. Every other number on this DTO answers "how many have a wallet pass
   * installed right now" (adoption, platform, registrations_per_attendee); this is the only one
   * that also surfaces passes that were confirmed installed and have since been removed from every
   * device - a retention/removal signal the rest of the tab has no way to show (PO review: "80
   * installed, 25 removed before the event" points at a UX/communication problem the adoption
   * number alone hides). */
  wallet_lifecycle: {
    /** At least one active registration on any platform the event still offers - the same
     * definition `classifyPassPlatform` uses for "confirmed" (platform !== "none"). */
    active: number;
    /** Zero active registrations on every enabled platform, but at least one inactive
     * registration on an enabled platform - the pass was confirmed installed at some point and has
     * since been removed from every device/account it was ever added to. Deliberately not "any
     * inactive registration count > 0" on its own: an attendee can have an active registration on
     * one device and an unrelated inactive registration left over from a different, since-removed
     * device (or a different platform entirely) - that pass is still genuinely in active use, so it
     * counts as `active` above, not here. */
    removed: number;
    /** Issued, but zero registrations - active or inactive - on every enabled platform: the pass
     * was never added to a wallet app on any platform this event currently offers. */
    never_installed: number;
  };
}
