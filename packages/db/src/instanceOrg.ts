import type { PrismaClient } from "./generated/prisma/client.js";

/** Stable default organization id from tenant_foundation migration / seed. */
export const INSTANCE_ORG_DEFAULT_ID = "org_default";

const NO_ORG_MESSAGE = "No organization found. Run seed or set INSTANCE_ORG_ID.";

/**
 * Resolves the deployment's instance organization id.
 * Precedence: INSTANCE_ORG_ID env → org_default row → first org by id.
 *
 * Lives here (not apps/web, where it originated) so packages/auth can call it too without
 * depending on apps/web - the wrong direction for a foundational package to depend in. Both
 * apps/web/src/admin/instance-org.ts and packages/auth/src/settings/instance-org.ts re-export this
 * verbatim rather than each keeping their own copy (SonarCloud's new-code duplication gate caught
 * the two near-identical implementations when packages/auth first needed this).
 */
export async function resolveInstanceOrganizationId(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const fromEnv = env.INSTANCE_ORG_ID?.trim();
  if (fromEnv) {
    const org = await prisma.organization.findUnique({
      where: { id: fromEnv },
      select: { id: true },
    });
    if (!org) {
      throw new Error("INSTANCE_ORG_ID does not match any organization");
    }
    return org.id;
  }

  const preferred = await prisma.organization.findUnique({
    where: { id: INSTANCE_ORG_DEFAULT_ID },
    select: { id: true },
  });
  if (preferred) return preferred.id;

  const first = await prisma.organization.findFirst({
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!first) {
    throw new Error(NO_ORG_MESSAGE);
  }
  return first.id;
}
