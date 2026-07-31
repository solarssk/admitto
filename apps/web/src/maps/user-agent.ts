/**
 * Dynamic Nominatim User-Agent, built server-side from data Instance Settings already
 * collects for exactly this purpose (see `Organization.support_contact_*` schema comment).
 * No new env var: Nominatim's Usage Policy wants an identifiable client + contact, and
 * asking every admin to hand-type a `MAPS_USER_AGENT` would duplicate what Support contact
 * (Settings → General) already captures.
 */
import type { PrismaClient } from "@admitto/db";
import { getInstanceUrl } from "@admitto/auth";
import { resolveInstanceOrganizationId } from "../admin/instance-org.js";
import { resolveProductVersion } from "../ops/product-version.js";

type EnvLike = NodeJS.ProcessEnv;

const FALLBACK_HOST = "self-hosted";
const FALLBACK_CONTACT = "no-contact-configured";

/** Support contact string (email preferred, else name), or null when neither is set or the
 * instance organization cannot be resolved (e.g. fresh install before seeding). */
async function resolveSupportContact(db: PrismaClient, env: EnvLike): Promise<string | null> {
  try {
    const orgId = await resolveInstanceOrganizationId(db, env);
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { support_contact_name: true, support_contact_email: true },
    });
    const email = org?.support_contact_email?.trim();
    const name = org?.support_contact_name?.trim();
    return email || name || null;
  } catch {
    return null;
  }
}

/** Builds `Admitto/{version} (+{instanceUrl}; {contact})` for the Nominatim request header.
 * Falls back to non-identifying placeholders when instance URL / support contact are unset
 * (still a valid, if less helpful, User-Agent) — see {@link isGeocodingContactConfigured} for
 * the UI warning that nudges admins to fill in Support contact instead. */
export async function buildGeocodingUserAgent(
  db: PrismaClient,
  env: EnvLike = process.env,
): Promise<string> {
  const version = resolveProductVersion();
  const instanceUrl = await getInstanceUrl(db).catch(() => null);
  const contact = await resolveSupportContact(db, env);
  const host = instanceUrl?.trim() || FALLBACK_HOST;
  return `Admitto/${version} (+${host}; ${contact ?? FALLBACK_CONTACT})`;
}

/** Whether Support contact (name or email) is configured on the instance organization —
 * drives the Location tab's "add a support contact" notice, without exposing the actual
 * contact value to every admin calling the search endpoint. */
export async function isGeocodingContactConfigured(
  db: PrismaClient,
  env: EnvLike = process.env,
): Promise<boolean> {
  return (await resolveSupportContact(db, env)) !== null;
}
