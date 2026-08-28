/** Minimal shape needed to resolve which wallet platforms an event actually offers - a subset of
 * the various "event" DTOs/rows across the codebase (admin EventDto, EventSummary, Prisma Event
 * rows), so this doesn't depend on any one of them. */
export interface EventWalletToggles {
  wallet_enabled: boolean;
  wallet_apple_enabled: boolean;
  wallet_google_enabled: boolean;
  wallet_samsung_enabled: boolean;
}

export interface EnabledWalletPlatforms {
  apple: boolean;
  google: boolean;
  /** Reserved for whenever PassCreator adds Samsung Wallet support - no attendee ever actually gets
   * a Samsung pass yet, so unlike apple/google this has no real functional surface of its own
   * (Attendees column, attendee Wallet card, and `any` below all stay Apple/Google-only). It exists
   * purely to gate Reports' platform-breakdown legend entry for Samsung, matching apple/google. */
  samsung: boolean;
  /** True when at least one platform is actually available - the correct check for "should any
   * wallet-related UI show at all" (covers both the master wallet_enabled switch being off and
   * wallet_enabled on with both individual platforms off). Deliberately Apple/Google only - see
   * `samsung`'s own doc comment above. */
  any: boolean;
}

/** Which wallet platform(s) are actually enabled for an event, combining the master switch with
 * each platform's own toggle (Event Settings -> Wallet). Distinct from "is wallet actually
 * configured" (template + API key present) - that's a separate concern the public ticket page
 * checks for itself (apps/web/src/app.ts) before offering a working Add-to-wallet button; this is
 * purely about what the event owner has chosen to expose, which is what admin surfaces (attendee
 * detail, the Attendees list, Reports) should reflect regardless of configuration state. */
export function enabledWalletPlatforms(event: EventWalletToggles): EnabledWalletPlatforms {
  const apple = event.wallet_enabled && event.wallet_apple_enabled;
  const google = event.wallet_enabled && event.wallet_google_enabled;
  const samsung = event.wallet_enabled && event.wallet_samsung_enabled;
  return { apple, google, samsung, any: apple || google };
}
