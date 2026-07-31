import type { PrismaClient } from "@admitto/db";
import { findEnabledOidcProviders, resolveSsoLoginButtonLabel } from "@admitto/auth";
import type { LoginSsoProvider } from "../login-page.js";

/** Load enabled SSO providers; fail open so local login stays available. */
export async function loadLoginSsoProviders(db: PrismaClient): Promise<LoginSsoProvider[]> {
  try {
    const providers = await findEnabledOidcProviders(db);
    return providers.map((p) => ({
      id: p.id,
      button_label: resolveSsoLoginButtonLabel(p.login_button_label),
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("Login SSO provider list failed:", message);
    return [];
  }
}
