import type { Prisma } from "@admitto/db";
import type { EnabledWalletPlatforms } from "@admitto/shared";

/** Raw (ungated) "was this pass ever confirmed installed anywhere" - the same historical fact
 * `everInstalledAnywhere` computes in-memory for the Wallets reports aggregate
 * (apps/web/src/admin/reports-routes.ts), expressed as a Prisma filter instead. Moved here
 * (rather than kept private to reports-routes.ts) so bulk-send-routes.ts's `wallet_status`
 * recipient filter can reuse the exact same NULL-safety-sensitive logic instead of duplicating it
 * (AGENTS.md flags structural duplicates of wallet filter logic as a real SonarCloud risk). Each
 * column filter pairs `gt: 0` with an explicit `not: null` - without it, a genuinely never-synced
 * pass (a real, common state pre-sync) makes that one column's own SQL comparison evaluate to NULL
 * rather than false; ORed with another platform's real false/true value that's still NULL, and a
 * caller negating this whole filter with `NOT:` gets `NOT NULL`, which is NULL too - the attendee
 * then matches neither side and silently vanishes from both a with- and without-wallet total. */
export function buildEverInstalledWalletFilter(): Prisma.AttendeeWhereInput {
  return {
    OR: [
      { wallet_pass: { first_confirmed_at: { not: null } } },
      { wallet_pass: { apple_active_registrations: { gt: 0, not: null } } },
      { wallet_pass: { google_active_registrations: { gt: 0, not: null } } },
      { wallet_pass: { samsung_active_registrations: { gt: 0, not: null } } },
      { wallet_pass: { apple_inactive_registrations: { gt: 0, not: null } } },
      { wallet_pass: { google_inactive_registrations: { gt: 0, not: null } } },
      { wallet_pass: { samsung_inactive_registrations: { gt: 0, not: null } } },
    ],
  };
}

/** "Active right now", gated to only the platforms this event currently offers - matching
 * `classifyPassPlatform`'s own live-right-now definition (reports-routes.ts). A registration on a
 * platform the event has since disabled must not count, so a disabled platform's column is
 * dropped from the OR entirely rather than merely compared to 0. When no platform is enabled at
 * all, returns a filter that matches nobody - an empty `{ OR: [] }` isn't reliable enough across
 * Prisma versions to lean on for "matches nothing". Each clause pairs `gt: 0` with an explicit
 * `not: null` - this filter is only ever used bare (positive) elsewhere, where the pairing makes
 * no observable difference (`x > 0` is already false for SQL NULL), but `buildWalletLifecycleFilter`
 * below negates it wholesale for the "removed" bucket, and `NOT (x > 0)` on a real NULL column is
 * itself NULL (three-valued SQL logic), not true - silently dropping every attendee whose
 * wallet_pass row exists with a null registration count from the negated result (found via a real
 * regression: confirmed empirically against the test DB, matching the exact same NULL-safety trap
 * `buildEverInstalledWalletFilter` above already documents and guards against). */
export function buildActiveWalletFilter(enabledPlatforms: EnabledWalletPlatforms): Prisma.AttendeeWhereInput {
  const clauses: Prisma.AttendeeWhereInput[] = [];
  if (enabledPlatforms.apple) clauses.push({ wallet_pass: { apple_active_registrations: { gt: 0, not: null } } });
  if (enabledPlatforms.google) clauses.push({ wallet_pass: { google_active_registrations: { gt: 0, not: null } } });
  if (enabledPlatforms.samsung) clauses.push({ wallet_pass: { samsung_active_registrations: { gt: 0, not: null } } });
  if (clauses.length === 0) return { id: { in: [] } };
  return { OR: clauses };
}

export type WalletLifecycleStatus = "active" | "removed" | "never_installed";

/** Same three-way split as the Wallets reports `wallet_lifecycle` card
 * (`classifyPassLifecycle`, reports-routes.ts), expressed as a Prisma filter instead of an
 * in-memory per-row classification - used by the mail bulk-send "By wallet status" recipient
 * filter. `removed` doesn't need its own inactive-registration check: a gated inactive count > 0
 * always implies the ungated `buildEverInstalledWalletFilter` is already true (the same real
 * inactive registration also satisfies that filter's own inactive-registration clause), so
 * "removed" reduces to exactly "ever installed, but not active now". */
export function buildWalletLifecycleFilter(
  status: WalletLifecycleStatus,
  enabledPlatforms: EnabledWalletPlatforms,
): Prisma.AttendeeWhereInput {
  switch (status) {
    case "active":
      return buildActiveWalletFilter(enabledPlatforms);
    case "removed":
      return { AND: [buildEverInstalledWalletFilter(), { NOT: buildActiveWalletFilter(enabledPlatforms) }] };
    case "never_installed":
      return { NOT: buildEverInstalledWalletFilter() };
  }
}
