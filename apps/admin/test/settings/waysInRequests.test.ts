import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/client.js", () => ({
  fetchRegistrationAccessMethods: vi.fn(),
  fetchRegistrationSsoProvider: vi.fn(),
  saveRegistrationAccessMethods: vi.fn(),
  saveRegistrationSsoProvider: vi.fn(),
}));

import { fetchRegistrationAccessMethods, fetchRegistrationSsoProvider, saveRegistrationAccessMethods, saveRegistrationSsoProvider } from "../../src/api/client.js";
import type { AccessMethodsDraft } from "../../src/settings/registrationAccessMethods.js";
import { fetchWaysIn, NOTHING_SAVED, saveWaysIn } from "../../src/settings/waysInRequests.js";
import { accessMethodsDto, ssoProviderDto } from "./accessMethodsFixtures.js";

const draft = (overrides: Partial<AccessMethodsDraft> = {}): AccessMethodsDraft => ({ link: false, password: false, sso: false, ssoProviderId: null, ...overrides });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(saveRegistrationAccessMethods).mockImplementation((body) => Promise.resolve(accessMethodsDto(body.methods)));
  vi.mocked(saveRegistrationSsoProvider).mockImplementation((body) =>
    Promise.resolve(ssoProviderDto({ provider_id: body.provider_id, state: body.provider_id === null ? "not_selected" : "ready" })),
  );
});

describe("fetchWaysIn", () => {
  it("reads the ways in and the provider together, and hands the abort signal to both", async () => {
    vi.mocked(fetchRegistrationAccessMethods).mockResolvedValue(accessMethodsDto(["sso"]));
    vi.mocked(fetchRegistrationSsoProvider).mockResolvedValue(ssoProviderDto());
    const controller = new AbortController();

    const ways = await fetchWaysIn(controller.signal);

    expect(ways).toEqual({ methods: accessMethodsDto(["sso"]), sso: ssoProviderDto() });
    expect(fetchRegistrationAccessMethods).toHaveBeenCalledWith(controller.signal);
    expect(fetchRegistrationSsoProvider).toHaveBeenCalledWith(controller.signal);
  });

  it("fails when either read fails, so that the panel shows its load error", async () => {
    vi.mocked(fetchRegistrationAccessMethods).mockResolvedValue(accessMethodsDto());
    vi.mocked(fetchRegistrationSsoProvider).mockRejectedValue(new Error("down"));

    await expect(fetchWaysIn()).rejects.toThrow("down");
  });
});

describe("saveWaysIn", () => {
  it("sends only the request of a part that changed", async () => {
    await saveWaysIn(draft({ link: true }), draft());
    expect(saveRegistrationAccessMethods).toHaveBeenCalledWith({ methods: ["link"] });
    expect(saveRegistrationSsoProvider).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await saveWaysIn(draft({ ssoProviderId: "idp-okta" }), draft());
    expect(saveRegistrationSsoProvider).toHaveBeenCalledWith({ provider_id: "idp-okta" });
    expect(saveRegistrationAccessMethods).not.toHaveBeenCalled();
  });

  it("sends both when both changed, and keeps the answer of each", async () => {
    const result = await saveWaysIn(draft({ sso: true, ssoProviderId: "idp-okta" }), draft());

    expect(result.failures).toEqual([]);
    expect(result.saved.methods).toEqual(accessMethodsDto(["sso"]));
    expect(result.saved.sso).toMatchObject({ provider_id: "idp-okta", state: "ready" });
  });

  it("keeps what worked when the other request fails, and says why the failed one did", async () => {
    const refusal = new Error("provider_not_available");
    vi.mocked(saveRegistrationSsoProvider).mockRejectedValue(refusal);

    const result = await saveWaysIn(draft({ sso: true, ssoProviderId: "idp-okta" }), draft());

    expect(result.saved.methods).toEqual(accessMethodsDto(["sso"]));
    expect(result.saved.sso).toBeNull();
    expect(result.failures).toEqual([refusal]);
  });

  it("reports every failure when both requests fail, and never rejects", async () => {
    const first = new Error("one");
    const second = new Error("two");
    vi.mocked(saveRegistrationAccessMethods).mockRejectedValue(first);
    vi.mocked(saveRegistrationSsoProvider).mockRejectedValue(second);

    const result = await saveWaysIn(draft({ sso: true, ssoProviderId: "idp-okta" }), draft());

    expect(result.saved).toEqual({ methods: null, sso: null });
    expect(result.failures).toEqual([first, second]);
  });

  it("is the empty result when there is nothing to send", async () => {
    expect(await saveWaysIn(draft(), draft())).toEqual(NOTHING_SAVED);
    expect(saveRegistrationAccessMethods).not.toHaveBeenCalled();
    expect(saveRegistrationSsoProvider).not.toHaveBeenCalled();
  });
});
