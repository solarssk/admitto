import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const PROVIDER_ID = "oidc-grant-index-provider";
const USER_ID = "oidc-grant-index-user";

let prisma: PrismaClient | undefined;

beforeAll(async () => {
  execSync("npx prisma migrate reset --force --skip-seed", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = new PrismaClient();
  await prisma.identityProvider.create({
    data: {
      id: PROVIDER_ID,
      provider_type: "oidc",
      issuer: "https://oidc-grant-index.example.com/",
      client_id: "client",
      authorization_endpoint: "https://oidc-grant-index.example.com/authorize",
      token_endpoint: "https://oidc-grant-index.example.com/token",
      jwks_uri: "https://oidc-grant-index.example.com/jwks",
      display_name: "OIDC Grant Index Test",
    },
  });
  await prisma.user.create({
    data: {
      id: USER_ID,
      email: "oidc-grant-index@example.com",
    },
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("OidcRoleGrant partial unique indexes", () => {
  it("rejects duplicate instance-scope grants where scope_id is null", async () => {
    const assignment = await prisma!.roleAssignment.create({
      data: {
        user_id: USER_ID,
        role: "superadmin",
        scope_type: "instance",
        scope_id: null,
      },
    });

    await prisma!.oidcRoleGrant.create({
      data: {
        user_id: USER_ID,
        provider_id: PROVIDER_ID,
        role: "superadmin",
        scope_type: "instance",
        scope_id: null,
        role_assignment_id: assignment.id,
      },
    });

    await expect(
      prisma!.oidcRoleGrant.create({
        data: {
          user_id: USER_ID,
          provider_id: PROVIDER_ID,
          role: "superadmin",
          scope_type: "instance",
          scope_id: null,
          role_assignment_id: assignment.id,
        },
      }),
    ).rejects.toThrow();
  });
});
