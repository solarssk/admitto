import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";

vi.mock("@admitto/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/auth")>();
  return {
    ...actual,
    findEnabledOidcProviders: vi.fn(),
    resolveSsoLoginButtonLabel: vi.fn((label: string | null) => label ?? "Sign in with SSO"),
  };
});

import { findEnabledOidcProviders, resolveSsoLoginButtonLabel } from "@admitto/auth";
import { loadLoginSsoProviders } from "../src/auth/login-sso.js";

const findProviders = vi.mocked(findEnabledOidcProviders);
const resolveLabel = vi.mocked(resolveSsoLoginButtonLabel);

describe("loadLoginSsoProviders", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps enabled OIDC providers to login button payloads", async () => {
    findProviders.mockResolvedValue([
      { id: "contoso", login_button_label: "Contoso SSO" },
      { id: "fabrikam", login_button_label: null },
    ] as Awaited<ReturnType<typeof findEnabledOidcProviders>>);
    resolveLabel.mockImplementation((label) => label ?? "Sign in with SSO");

    const result = await loadLoginSsoProviders({} as PrismaClient);

    expect(result).toEqual([
      { id: "contoso", button_label: "Contoso SSO" },
      { id: "fabrikam", button_label: "Sign in with SSO" },
    ]);
  });

  it("fails open with an empty list when provider lookup throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    findProviders.mockRejectedValue(new Error("db down"));

    await expect(loadLoginSsoProviders({} as PrismaClient)).resolves.toEqual([]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("fails open when the thrown value is not an Error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    findProviders.mockRejectedValue("boom");

    await expect(loadLoginSsoProviders({} as PrismaClient)).resolves.toEqual([]);
    expect(err).toHaveBeenCalledWith("Login SSO provider list failed:", "unknown");
    err.mockRestore();
  });
});
