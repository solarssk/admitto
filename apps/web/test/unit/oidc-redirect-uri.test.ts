import type { PrismaClient } from "@admitto/db";
import { InstanceUrlRequiredError } from "@admitto/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/instance-base-url.js", () => ({
  resolveInstanceBaseUrl: vi.fn(),
}));

import { resolveInstanceBaseUrl } from "../../src/instance-base-url.js";
import { resolveOidcRedirectUri, resolveOidcPublicBaseUrlOrNull } from "../../src/admin/oidc-redirect-uri.js";

const mockResolve = vi.mocked(resolveInstanceBaseUrl);

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveOidcRedirectUri", () => {
  it("builds the callback URL from the resolved public base", async () => {
    mockResolve.mockResolvedValueOnce("https://tickets.example.com/");
    await expect(resolveOidcRedirectUri({} as PrismaClient, "prov1")).resolves.toBe(
      "https://tickets.example.com/api/auth/oidc/prov1/callback",
    );
    expect(mockResolve).toHaveBeenCalledWith({}, process.env, undefined);
  });

  it("passes through an injected base URL", async () => {
    mockResolve.mockResolvedValueOnce("https://injected.example.com");
    await expect(
      resolveOidcRedirectUri({} as PrismaClient, "prov2", "https://injected.example.com"),
    ).resolves.toBe("https://injected.example.com/api/auth/oidc/prov2/callback");
    expect(mockResolve).toHaveBeenCalledWith({}, process.env, "https://injected.example.com");
  });

  it("returns null when Instance URL is required but missing", async () => {
    mockResolve.mockRejectedValueOnce(new InstanceUrlRequiredError());
    await expect(resolveOidcRedirectUri({} as PrismaClient, "prov3")).resolves.toBeNull();
  });

  it("rethrows unexpected resolution errors", async () => {
    mockResolve.mockRejectedValueOnce(new Error("db down"));
    await expect(resolveOidcRedirectUri({} as PrismaClient, "prov4")).rejects.toThrow("db down");
  });
});

describe("resolveOidcPublicBaseUrlOrNull", () => {
  it("returns the resolved base URL", async () => {
    mockResolve.mockResolvedValueOnce("https://tickets.example.com/");
    await expect(resolveOidcPublicBaseUrlOrNull({} as PrismaClient)).resolves.toBe(
      "https://tickets.example.com/",
    );
  });

  it("returns null when Instance URL is required but missing (logout must still complete)", async () => {
    mockResolve.mockRejectedValueOnce(new InstanceUrlRequiredError());
    await expect(resolveOidcPublicBaseUrlOrNull({} as PrismaClient)).resolves.toBeNull();
  });

  it("rethrows unexpected resolution errors", async () => {
    mockResolve.mockRejectedValueOnce(new Error("db down"));
    await expect(resolveOidcPublicBaseUrlOrNull({} as PrismaClient)).rejects.toThrow("db down");
  });
});
