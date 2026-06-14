import type { PrismaClient } from "@prisma/client";
import { findEnabledOidcProviders } from "@admitto/auth";
import type { LoginSsoProvider } from "../login-page.js";

/** Load enabled SSO providers; fail open so local login stays available. */
export async function loadLoginSsoProviders(db: PrismaClient): Promise<LoginSsoProvider[]> {
  try {
    const providers = await findEnabledOidcProviders(db);
    return providers.map((p) => ({ id: p.id, display_name: p.display_name }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("Login SSO provider list failed:", message);
    return [];
  }
}
