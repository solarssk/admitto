import type { WalletProviderCapabilities, WalletProviderConsistencyPolicy } from "./types.js";

/**
 * Static facts about each wallet provider - deliberately in its own module with type-only imports,
 * so the admin SPA can read them through the `@admitto/wallet/capabilities` subpath without pulling
 * the package root's node-only barrel into a browser chunk (see AGENTS.md, "Do not import
 * `@admitto/wallet` (package root) from `apps/admin`").
 */

/** PassCreator (ADR 0041): DELETE /api/v3/pass/{id} exists, void/restore go through the legacy
 * PUT /api/pass/{uid}, and GET /api/v3/pass returns `voided`, `expirationDate` and per-platform
 * registration counts in one row. */
export const PASSCREATOR_CAPABILITIES: WalletProviderCapabilities = {
  lifecycleObservation: true,
  expiration: true,
  voidRestore: true,
  registrationSnapshot: true,
  remoteDelete: true,
};

/** PassCreator's search endpoint (the only way to read a pass back, see
 * PassCreatorClient.searchByUserProvidedId) is backed by an index that can briefly trail a
 * status-affecting event, so a read shortly after Admitto's own void/restore may still show the
 * previous state. 10 minutes is a generous ceiling, not a measured value. */
export const PASSCREATOR_CONSISTENCY_POLICY: WalletProviderConsistencyPolicy = {
  observationStalenessWindowMs: 10 * 60 * 1000,
};

/** Keyed by `WalletPass.provider` / `WalletPassProvider.provider`. A Map, not an object literal:
 * a lookup by an arbitrary string must not resolve to an inherited Object.prototype member. */
const CAPABILITIES_BY_PROVIDER: ReadonlyMap<string, WalletProviderCapabilities> = new Map([
  ["passcreator", PASSCREATOR_CAPABILITIES],
]);

/** Capabilities of the named provider, or null for one this build doesn't know. */
export function walletProviderCapabilities(provider: string): WalletProviderCapabilities | null {
  return CAPABILITIES_BY_PROVIDER.get(provider) ?? null;
}
