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
  /** `confirmed` means "was ever confirmed installed" (WalletPass.first_confirmed_at set, or any
   * active/inactive registration count > 0 on any platform, ever) - a permanent historical fact,
   * not "is active on a device right now" (architect review, 2026-09-03, following on from the
   * 2026-09-03 registration-sync fix: a later pass removal, or PassCreator losing track of a
   * registration, must not silently walk this number back down for a report meant to be read long
   * after the event ends). For the live "installed right now" equivalent, see
   * `wallet_lifecycle.active` below - that field's own doc comment explains why it, `platform`,
   * and `registrations_per_attendee` stay live while this one went historical. */
  adoption: {
    got_pass: number;
    got_pass_pct: number;
    confirmed: number;
    confirmed_pct: number;
  };
  /** Mutually exclusive - a pass can be actively registered on more than one platform at once
   * (the same attendee opening their ticket link on both an iPhone and an Android device, say),
   * so a naive apple-count + google-count double-counts that pass. These four always sum to
   * exactly `wallet_lifecycle.active` (not `adoption.confirmed` - see that field's own doc
   * comment) - a pass with no active registration on any platform isn't a "platform" at all, so
   * it has no slice here (see the Wallets tab's own platform-split card). This field stays a
   * live-right-now count by explicit architect decision (2026-09-03): no per-platform history is
   * persisted anywhere, so once a pass's registration on some platform goes inactive there's no
   * honest way to still attribute it to that platform after the fact - unlike `adoption.confirmed`
   * above, which only needs to answer "installed at all, ever" and can do that from
   * first_confirmed_at/inactive-registration history alone. `samsung_only` only wins when neither
   * Apple nor Google is active - `both` stays Apple+Google specifically (see classifyPassPlatform's
   * own doc comment, apps/web/src/admin/reports-routes.ts, for why a full 3-way combinatorial
   * split isn't worth modeling for a state that can't happen yet). */
  platform: {
    apple_only: number;
    google_only: number;
    samsung_only: number;
    both: number;
  };
  /** How many active device/account registrations each currently-active attendee's single pass
   * has, bucketed - provider-agnostic (reads WalletPass.apple_active_registrations +
   * google_active_registrations, generic columns any WalletPassProvider populates the same way,
   * not anything PassCreator-specific). One WalletPass per attendee (attendee_id is unique), so
   * this is genuinely "how many attendees have their one pass on N devices/accounts", not a count
   * of passes. Counts only currently-active attendees (`wallet_lifecycle.active`, not
   * `adoption.confirmed` - same live-vs-historical split as `platform` above, and for the same
   * reason: a removed registration's device count isn't real information any more) - an attendee
   * with zero active registrations isn't in any bucket here. Buckets always sum to exactly
   * `wallet_lifecycle.active`. */
  registrations_per_attendee: {
    /** `registrations` is each bucket's own attendees' device/account counts summed, not `count`
     * multiplied by the bucket's device number - exact even for "4_plus" (whatever those attendees'
     * real counts past 4 actually are), unlike a naive count*4 that would undercount. Every
     * bucket's `registrations` always sums to exactly `total` below, the same way `count` always
     * sums to `wallet_lifecycle.active`. */
    buckets: Array<{ key: "1" | "2" | "3" | "4_plus"; count: number; pct: number; registrations: number }>;
    /** Sum of every active attendee's own device/account count - unlike the buckets above, this
     * isn't capped at the "4_plus" bucket, so it's the true total device registrations right now
     * among platforms this event currently has enabled (comparable to a wallet provider's own
     * "active registrations" figure for those same platforms, which counts the same way: once per
     * device, not once per attendee). Like `platform`/`wallet_lifecycle.active` elsewhere in this
     * response, a registration on a platform this event has since disabled doesn't count here even
     * though it's still real and active on the attendee's own device (bot review) - this can
     * genuinely read lower than the provider's own total in that specific case. */
    total: number;
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
    /** Ever confirmed installed, i.e. the same (historical - see `adoption.confirmed`'s own doc
     * comment) definition as `adoption.confirmed` scoped to this ticket type - what the Wallets
     * tab's "Adoption by ticket type" card shows, distinct from `got_pass` above
     * (issued-but-not-installed passes don't count here). */
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
  /** First-touch above; this is its last-touch companion, not a replacement - re-anchoring
   * time_to_wallet_tap itself onto whatever nudge happened to be sent most recently would silently
   * change what that number has always meant release over release. Counts only the subset of
   * `adoption.confirmed` who received a wallet-CTA email through a template other than the ticket
   * one (any Communication campaign whose subject/body referenced apple_wallet_url/
   * google_wallet_url - EmailDelivery.had_wallet_cta) before they installed, anchored on the most
   * recent such delivery (see latestWalletReminderDeliverySuccessBefore, reports-routes.ts, for why
   * latest-before-install rather than earliest-overall). `eligible_count` is how many of
   * `adoption.confirmed` even qualify - expect 0 until a wallet-CTA campaign has actually gone out,
   * and even after, most installs still won't be attributable to one. */
  time_to_install_after_reminder: {
    eligible_count: number;
    average_days: number | null;
    buckets: Array<{ key: "same_day" | "1_3" | "4_7" | "8_plus"; count: number; pct: number }>;
  };
  /** "with_wallet" means the pass was ever confirmed installed (same historical definition as
   * `adoption.confirmed` above) - not merely issued. An attendee who got the ticket-link email but
   * never actually added the pass to a wallet app behaves like the without-wallet group for this
   * comparison's own purpose (does *having* a working pass correlate with showing up), so they're
   * counted there, matching the card's own description ("... who installed a wallet pass"). */
  admission_by_wallet: {
    with_wallet: { total: number; admitted: number; pct: number };
    without_wallet: { total: number; admitted: number; pct: number };
  };
  /** What WalletPass.status says about every issued pass - independent of, and not to be confused
   * with, `wallet_lifecycle` below (registration state) or `provider_state` (whether the pass
   * still exists at the wallet provider). Always sums to exactly `adoption.got_pass`. A pass can
   * be `voided` (invalidated - reversible via Restore until the event ends - whether an admin
   * voided it directly or a sync/refresh reconciled the wallet provider's own report of it as
   * voided, see reconcileWalletPassLifecycle) or have
   * naturally `expired`, while still being `managed` in `provider_state` (removing it there is a
   * separate, later step) and while still showing as `active`/`removed` in `wallet_lifecycle`
   * (whether it's still on a device is a different question from whether it's still valid) - the
   * three normal axes are deliberately independent, not nested.
   *
   * `failed` should read 0 - a `createPass` attempt that never actually issued a pass normally
   * never sets `issued_at` (see `markActive`/`markFailed`, apps/web/src/app.ts), so it would
   * ordinarily be outside this population entirely, not a bucket here. It exists only to catch a
   * known, narrow concurrency race in that same issuance code (two app instances racing to create
   * one attendee's pass: the winner's `markActive` sets `issued_at`, and if the loser's own
   * duplicate-recovery search then also misses due to provider search-index lag, its `markFailed`
   * call can clobber `status` back to `"failed"` on that same, already-issued row without clearing
   * `issued_at` - `markFailed`'s upsert has no guard against this). Kept as its own bucket, not
   * silently dropped, so this field's own "always sums to `adoption.got_pass`" promise holds
   * unconditionally rather than quietly failing whenever that race is hit (bot review). */
  pass_validity: {
    active: number;
    voided: number;
    expired: number;
    failed: number;
  };
  /** Whether Admitto has permanently deleted every issued pass at the wallet provider (`removed`,
   * via "Remove from provider" or "Remove inactive passes" - see Wallet-Passes-Overview.md) or not
   * (`managed`) - NOT a live check of whether the pass still genuinely exists at the provider.
   * `provider_removed_at` is only ever set by Admitto's own confirmed delete call - a pass deleted
   * directly at the provider, outside Admitto, is never detected as gone this way
   * (refreshOneWalletPassStatus's own doc comment: a provider lookup with no match throws
   * WalletStatusCheckInconclusiveError rather than being read as proof of deletion, since a search-
   * index lag looks the same as a real deletion) and keeps reading `managed` until reached by one
   * of the two actions above. Always sums to exactly `adoption.got_pass`, independent of
   * `pass_validity` and `wallet_lifecycle`: a removed pass is always voided or expired (Remove
   * requires one of those first, see removeOneWalletPassFromProvider's own doc comment), but it
   * doesn't disappear from this report the way it disappears from the provider's own dashboard once
   * removed. */
  provider_state: {
    managed: number;
    removed: number;
  };
  /** What became of every issued pass, as far as registration on a device is concerned right now
   * (this DTO's "last known" registration-state axis) - mutually exclusive, always summing to
   * exactly `adoption.got_pass`, and splitting `adoption.confirmed` itself into its two
   * components: `active` + `removed` == `adoption.confirmed` (the core "Installed = Active +
   * Removed" identity this field exists to make explicit - architect review, 2026-09-03).
   * Independent of `pass_validity`/`provider_state` above - a pass can be `active` here while
   * `voided` in `pass_validity` (a void doesn't touch registration counts by itself; only a later
   * push/removal does), or `removed` here while still `managed` in `provider_state` (an attendee
   * uninstalling a still-valid, still-provider-managed pass). Most numbers on this DTO (adoption,
   * by_ticket_type, admission_by_wallet, the two time-to-install cards) now answer "was a wallet
   * pass ever confirmed installed", a historical fact - `platform` and
   * `registrations_per_attendee` are the (now unusual) exceptions that stay live-right-now, since
   * neither has any historical data to fall back on (no per-platform or per-device history is
   * persisted once a registration goes inactive). `active` below is this DTO's one live-right-now
   * number inside `wallet_lifecycle` itself; `removed` is what turns the historical `confirmed`
   * total into more than just a repeat of `active` - a retention/removal signal the rest of the
   * tab has no way to show on its own (PO review: "80 installed, 25 removed before the event"
   * points at a UX/communication problem the adoption number alone hides). Field name and values
   * kept as `wallet_lifecycle`/`active`/`removed`/`never_installed` (not renamed to match the
   * frontend's "Registration state (last known)" card title) so this contract doesn't churn for a
   * display-only rename - plan v4.2 step 4. */
  wallet_lifecycle: {
    /** At least one active registration on any platform the event still offers - the same
     * definition `classifyPassPlatform` uses for "active" (platform !== "none"), and the same
     * live-right-now count `platform`/`registrations_per_attendee` above sum to. */
    active: number;
    /** Not `active` above, but has real installation history somewhere: an inactive registration
     * on an enabled platform, a live registration on a platform the event has since disabled, or a
     * `first_confirmed_at` timestamp surviving a registration sync that came back with no current
     * match. Deliberately not "any inactive registration count > 0 on an enabled platform" alone:
     * an attendee can have an active registration on one device and an unrelated inactive
     * registration left over from a different, since-removed device (or a different platform
     * entirely) - that pass is still genuinely in active use, so it counts as `active` above, not
     * here. Unlike `active`, this history isn't re-evaluated against the event's *current* platform
     * toggles - a pass that installed and was removed (or is still live) on a platform since
     * disabled keeps that real history rather than reading as though it never happened. */
    removed: number;
    /** Issued, but with no installation history at all - no active or inactive registration ever
     * recorded on any platform (including one since disabled), and no `first_confirmed_at`. */
    never_installed: number;
  };
}
