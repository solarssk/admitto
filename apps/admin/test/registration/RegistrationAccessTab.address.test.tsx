// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistrationOwnAddressDto, RoleAssignment } from "../../src/api/types.js";
import { api } from "./accessApiMocks.js";
import { settings } from "./accessData.js";
import { renderLoaded, resetApi } from "./accessFixtures.js";

const goToLogin = vi.fn();
let assignments: RoleAssignment[] = [];

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    saveRegistrationSettings: (...args: unknown[]) => mocks.saveRegistrationSettings(...args),
    fetchLegalDocuments: (...args: unknown[]) => mocks.fetchLegalDocuments(...args),
    fetchRegistrationCounts: (...args: unknown[]) => mocks.fetchRegistrationCounts(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: (...args: unknown[]) => goToLogin(...args) }));
vi.mock("../../src/auth/AuthProvider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/auth/AuthProvider.js")>()),
  useOptionalAuth: () => ({ assignments }),
}));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

const SUPERADMIN: RoleAssignment = { role: "superadmin", scope_type: "instance", scope_id: null };
const ORG_ADMIN: RoleAssignment = { role: "admin", scope_type: "organization", scope_id: "org-1" };
const DOMAIN = "summit.acme.example";

const own = (overrides: Partial<RegistrationOwnAddressDto> = {}): RegistrationOwnAddressDto => ({
  domain: DOMAIN,
  status: "unchecked",
  check_result: null,
  verified: false,
  checked_at: null,
  ...overrides,
});

beforeEach(() => {
  resetApi();
  goToLogin.mockReset();
  assignments = [SUPERADMIN];
});

afterEach(() => {
  cleanup();
});


describe("the Registration tab has no card for the address (it is on the General tab)", () => {
  it("shows no address card and no field, whoever looks, with an address or without", async () => {
    for (const superadmin of [true, false]) {
      await renderLoaded(settings({ own_address: own({ status: "ok", verified: true, check_result: "ok" }) }), { superadmin });

      expect(screen.queryByText("Address for guests", { selector: ".at-card__title" })).toBeNull();
      expect(screen.queryByLabelText("Own address")).toBeNull();
      cleanup();
    }
  });
});

describe("the warning that an address stopped working", () => {
  const warning = () => screen.queryByText(/stopped working:/);

  it("is told to an administrator of the organisation, with the reason", async () => {
    await renderLoaded(settings({ own_address: own({ status: "failing", verified: true, check_result: "tls_failed" }) }), { superadmin: false });

    expect(warning()?.textContent).toContain("its HTTPS certificate is refused");
    expect(warning()?.closest(".at-notice--warning")).not.toBeNull();
  });

  it.each([
    ["an address that works", own({ status: "ok", verified: true, check_result: "ok" })],
    ["an address that never worked", own({ status: "failing", verified: false, check_result: "dns_failed" })],
    ["an address that is not checked", own()],
    ["no address", null],
  ])("is not told for %s", async (_what, address) => {
    await renderLoaded(settings({ own_address: address }));
    expect(warning()).toBeNull();
  });
});

