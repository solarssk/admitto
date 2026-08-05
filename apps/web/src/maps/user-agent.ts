/**
 * Dynamic Nominatim / MET Norway User-Agent, built server-side from data Instance Settings
 * already collects for exactly this purpose (see `Organization.support_contact_*` schema
 * comment). No new env var: Nominatim's Usage Policy wants an identifiable client + contact,
 * and asking every admin to hand-type a `MAPS_USER_AGENT` would duplicate what Support contact
 * (Settings → General) already captures.
 */
import type { PrismaClient } from "@admitto/db";
import { getInstanceUrl } from "@admitto/auth";
import { resolveInstanceOrganizationId } from "../admin/instance-org.js";
import { resolveProductVersion } from "../ops/product-version.js";

type EnvLike = NodeJS.ProcessEnv;

const FALLBACK_HOST = "self-hosted";
const FALLBACK_CONTACT = "no-contact-configured";

/**
 * RFC 2606 / special-use domains. MET Norway and Nominatim return HTTP 403 when the
 * User-Agent embeds an `@example.com` (etc.) address, so those must not go on the wire even
 * though seeds and local demos still store them as Support contact.
 */
const RESERVED_EMAIL_DOMAIN_SUFFIXES = [
  "example.com",
  "example.net",
  "example.org",
  "invalid",
  "localhost",
  "test",
] as const;

/** @internal exported for unit tests */
export function isReservedDocumentationEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  if (!domain) return false;
  return RESERVED_EMAIL_DOMAIN_SUFFIXES.some(
    (suffix) => domain === suffix || domain.endsWith(`.${suffix}`),
  );
}

/** Support contact string for outbound User-Agent (email preferred when usable, else name).
 * Returns null when neither is set, the org cannot be resolved, or the only email is a
 * reserved documentation address with no name to fall back to. */
async function resolveSupportContactForUserAgent(
  db: PrismaClient,
  env: EnvLike,
): Promise<string | null> {
  try {
    const orgId = await resolveInstanceOrganizationId(db, env);
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { support_contact_name: true, support_contact_email: true },
    });
    const email = org?.support_contact_email?.trim() || "";
    const name = org?.support_contact_name?.trim() || "";
    if (email && !isReservedDocumentationEmail(email)) return email;
    if (name) return name;
    return null;
  } catch {
    return null;
  }
}

/** Whether Support contact (name or email) is configured on the instance organization —
 * drives the Location / External services "add a support contact" notice. Documentation
 * emails still count as configured for the UI; they are stripped only from the User-Agent. */
export async function isGeocodingContactConfigured(
  db: PrismaClient,
  env: EnvLike = process.env,
): Promise<boolean> {
  try {
    const orgId = await resolveInstanceOrganizationId(db, env);
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { support_contact_name: true, support_contact_email: true },
    });
    const email = org?.support_contact_email?.trim();
    const name = org?.support_contact_name?.trim();
    return Boolean(email || name);
  } catch {
    return false;
  }
}

/** Builds `Admitto/{version} (+{instanceUrl}; {contact})` for Nominatim / MET Norway.
 * Falls back to non-identifying placeholders when instance URL / support contact are unset
 * (still a valid, if less helpful, User-Agent) — see {@link isGeocodingContactConfigured} for
 * the UI warning that nudges admins to fill in Support contact instead. */
export async function buildGeocodingUserAgent(
  db: PrismaClient,
  env: EnvLike = process.env,
): Promise<string> {
  const version = resolveProductVersion();
  const instanceUrl = await getInstanceUrl(db).catch(() => null);
  const contact = await resolveSupportContactForUserAgent(db, env);
  const host = instanceUrl?.trim() || FALLBACK_HOST;
  return `Admitto/${version} (+${host}; ${contact ?? FALLBACK_CONTACT})`;
}
