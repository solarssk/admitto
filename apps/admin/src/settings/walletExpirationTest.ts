import type { SettingsForm } from "../pages/EventSettingsPage.js";

/** Result of a "Test connection" probe, as far as the Wallet tab's "Pass expiration" field cares
 * (plan v4.2 step 6) - `fingerprint` identifies which (templateId, API key edit) combination it
 * applies to, `ready` is the template's own perPassExpirationReady capability. Own module (not
 * inlined in EventSettingsPage.tsx, which EventWalletPanel.tsx also needs) so importing it doesn't
 * drag EventSettingsPage.tsx's own runtime import graph (LocationSettingsPanel -> Leaflet, which
 * touches `window` at module load) into a plain-node test environment. */
export type WalletExpirationTest = { fingerprint: string; ready: boolean };

/** Identifies which (templateId, API key edit) combination a "Test connection" result applies to
 * - `walletExpirationTest` is keyed on this so editing either field after a successful test
 * invalidates the stale "Per-pass expiration: Ready" gate rather than carrying it over to
 * unverified credentials. Not a security boundary on its own: guardWalletExpirationModeChange
 * (event-settings-routes.ts) re-verifies with its own live describeTemplate() call at save time
 * regardless of what this client-side gate shows. */
export function walletTestFingerprint(form: Pick<SettingsForm, "walletTemplateId" | "walletApiKeyEdit">): string {
  const apiKeyPart = form.walletApiKeyEdit.mode === "replace" ? form.walletApiKeyEdit.value.trim() : "";
  return `${form.walletTemplateId.trim()}::${form.walletApiKeyEdit.mode}::${apiKeyPart}`;
}
