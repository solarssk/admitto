import { describe, expect, it } from "vitest";
import { INSTANCE_ORG_DEFAULT_ID, resolveInstanceOrganizationId } from "../src/settings/instance-org.js";

function stubDb(overrides: {
  findUniqueResults?: Record<string, { id: string } | null>;
  findFirstResult?: { id: string } | null;
}) {
  return {
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        overrides.findUniqueResults?.[where.id] ?? null,
      findFirst: async () => overrides.findFirstResult ?? null,
    },
  } as never;
}

describe("resolveInstanceOrganizationId", () => {
  it("uses INSTANCE_ORG_ID when set and it matches a real organization", async () => {
    const db = stubDb({ findUniqueResults: { "org-from-env": { id: "org-from-env" } } });
    await expect(
      resolveInstanceOrganizationId(db, { INSTANCE_ORG_ID: "org-from-env" }),
    ).resolves.toBe("org-from-env");
  });

  it("throws when INSTANCE_ORG_ID is set but matches no organization", async () => {
    const db = stubDb({});
    await expect(
      resolveInstanceOrganizationId(db, { INSTANCE_ORG_ID: "org-does-not-exist" }),
    ).rejects.toThrow(/INSTANCE_ORG_ID does not match/);
  });

  it("falls back to the org_default row when INSTANCE_ORG_ID is unset", async () => {
    const db = stubDb({ findUniqueResults: { [INSTANCE_ORG_DEFAULT_ID]: { id: INSTANCE_ORG_DEFAULT_ID } } });
    await expect(resolveInstanceOrganizationId(db, {})).resolves.toBe(INSTANCE_ORG_DEFAULT_ID);
  });

  it("falls back to the first organization by id when neither INSTANCE_ORG_ID nor org_default resolve", async () => {
    const db = stubDb({ findFirstResult: { id: "first-org" } });
    await expect(resolveInstanceOrganizationId(db, {})).resolves.toBe("first-org");
  });

  it("throws a clear error when no organization exists at all", async () => {
    const db = stubDb({});
    await expect(resolveInstanceOrganizationId(db, {})).rejects.toThrow(/No organization found/);
  });

  it("treats a whitespace-only INSTANCE_ORG_ID as unset", async () => {
    const db = stubDb({ findUniqueResults: { [INSTANCE_ORG_DEFAULT_ID]: { id: INSTANCE_ORG_DEFAULT_ID } } });
    await expect(resolveInstanceOrganizationId(db, { INSTANCE_ORG_ID: "   " })).resolves.toBe(
      INSTANCE_ORG_DEFAULT_ID,
    );
  });
});
