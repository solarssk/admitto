import type { PrismaClient } from "@admitto/db";

/** Stable default organization id from tenant_foundation migration / seed. */
export const INSTANCE_ORG_DEFAULT_ID = "org_default";

const NO_ORG_MESSAGE = "No organization found. Run seed or set INSTANCE_ORG_ID.";

/**
 * Resolves the deployment's instance organization id.
 * Precedence: INSTANCE_ORG_ID env → org_default row → first org by id.
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
