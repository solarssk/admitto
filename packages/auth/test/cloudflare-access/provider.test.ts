import { describe, expect, it, vi } from "vitest";
import type { IdentityProvider, PrismaClient } from "@admitto/db";
import {
  CF_ACCESS_CLIENT_ID_SENTINEL,
  ensureCloudflareAccessProvider,
} from "../../src/cloudflare-access/provider.js";

const teamDomain = "https://myteam.cloudflareaccess.com";

function cfProvider(overrides: Partial<IdentityProvider> = {}): IdentityProvider {
  return {
    id: "prov_cf",
    provider_type: "cloudflare_access",
    issuer: teamDomain,
    client_id: CF_ACCESS_CLIENT_ID_SENTINEL,
    client_secret_enc: null,
    authorization_endpoint: `${teamDomain}/cdn-cgi/access/login`,
    token_endpoint: `${teamDomain}/cdn-cgi/access/login`,
    jwks_uri: `${teamDomain}/cdn-cgi/access/certs`,
    userinfo_endpoint: null,
    claim_email: "email",
    claim_name: "name",
    claim_groups: "groups",
    claim_given_name: "given_name",
    claim_family_name: "family_name",
    claim_phone: "phone_number",
    enabled: true,
    display_name: "Cloudflare Access",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe("ensureCloudflareAccessProvider", () => {
  it("returns existing row without update when config unchanged", async () => {
    const existing = cfProvider();
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn();
    const upsert = vi.fn();
    const prisma = {
      identityProvider: { findFirst, update, upsert },
    } as unknown as PrismaClient;

    const result = await ensureCloudflareAccessProvider(prisma, {
      teamDomain,
      jwksUri: existing.jwks_uri,
      enabled: true,
    });

    expect(result).toBe(existing);
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("updates existing row by id when team domain or JWKS changes", async () => {
    const existing = cfProvider();
    const updated = cfProvider({ jwks_uri: `${teamDomain}/cdn-cgi/access/certs?v=2` });
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(updated);
    const upsert = vi.fn();
    const prisma = {
      identityProvider: { findFirst, update, upsert },
    } as unknown as PrismaClient;

    const result = await ensureCloudflareAccessProvider(prisma, {
      teamDomain,
      jwksUri: updated.jwks_uri,
      enabled: true,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: expect.objectContaining({ jwks_uri: updated.jwks_uri }),
    });
    expect(result).toBe(updated);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("uses upsert on unique issuer+client_id when no CF provider row exists", async () => {
    const created = cfProvider();
    const findFirst = vi.fn().mockResolvedValue(null);
    const update = vi.fn();
    const upsert = vi.fn().mockResolvedValue(created);
    const prisma = {
      identityProvider: { findFirst, update, upsert },
    } as unknown as PrismaClient;

    const result = await ensureCloudflareAccessProvider(prisma, {
      teamDomain,
      jwksUri: created.jwks_uri,
      enabled: true,
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        issuer_client_id: {
          issuer: teamDomain,
          client_id: CF_ACCESS_CLIENT_ID_SENTINEL,
        },
      },
      create: expect.objectContaining({
        provider_type: "cloudflare_access",
        issuer: teamDomain,
        client_id: CF_ACCESS_CLIENT_ID_SENTINEL,
      }),
      update: expect.objectContaining({
        issuer: teamDomain,
        client_id: CF_ACCESS_CLIENT_ID_SENTINEL,
      }),
    });
    expect(result).toBe(created);
    expect(update).not.toHaveBeenCalled();
  });
});
