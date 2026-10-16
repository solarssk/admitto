import type { PrismaClient } from "@admitto/db";
import { InstanceUrlRequiredError } from "@admitto/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/instance-base-url.js", () => ({
  resolveInstanceBaseUrl: vi.fn(),
}));

import { resolveInstanceBaseUrl } from "../../src/instance-base-url.js";
import {
  resolveLogoutBaseUrl,
  resolveOidcRedirectUri,
  resolveOidcPublicBaseUrlOrNull,
} from "../../src/admin/oidc-redirect-uri.js";

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

describe("resolveLogoutBaseUrl", () => {
  it("returns the resolved base URL", async () => {
    mockResolve.mockResolvedValueOnce("https://tickets.example.com/");
    await expect(resolveLogoutBaseUrl({} as PrismaClient, "https://injected.example.com")).resolves.toBe(
      "https://tickets.example.com/",
    );
    expect(mockResolve).toHaveBeenCalledWith({}, process.env, "https://injected.example.com");
  });

  it("returns null, quietly, when Instance URL is required but missing", async () => {
    mockResolve.mockRejectedValueOnce(new InstanceUrlRequiredError());
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(resolveLogoutBaseUrl({} as PrismaClient)).resolves.toBeNull();
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it("returns null for any other failure too (a malformed BASE_URL, a database error) and logs its name and code, never its message", async () => {
    mockResolve.mockRejectedValueOnce(Object.assign(new Error("BASE_URL must be a valid URL: secret-sentinel-3"), { code: "ERR_X" }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(resolveLogoutBaseUrl({} as PrismaClient)).resolves.toBeNull();
      expect(logged).toHaveBeenCalledWith("resolve base URL for sign out failed:", {
        error_name: "Error",
        error_code: "ERR_X",
      });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("secret-sentinel-3");
    } finally {
      logged.mockRestore();
    }
  });

  it("returns null for a failure that is not an Error", async () => {
    mockResolve.mockRejectedValueOnce("connection reset");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(resolveLogoutBaseUrl({} as PrismaClient)).resolves.toBeNull();
      expect(logged).toHaveBeenCalledWith("resolve base URL for sign out failed:", { error_name: "unknown" });
    } finally {
      logged.mockRestore();
    }
  });
});
