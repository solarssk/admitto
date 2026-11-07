import { describe, expect, it } from "vitest";
import { ssoProviderState } from "../src/registration/sso-provider.js";

describe("ssoProviderState: the state comes from the one stored id and the provider found for it", () => {
  it.each([
    ["no id is stored", null, null, "not_selected"],
    ["no id is stored, whatever else was found", null, { enabled: true }, "not_selected"],
    ["the stored id has no provider", "idp-1", null, "missing"],
    ["the provider is switched off", "idp-1", { enabled: false }, "disabled"],
    ["the provider is there and enabled", "idp-1", { enabled: true }, "ready"],
  ] as const)("is %s", (_label, id, provider, expected) => {
    expect(ssoProviderState(id, provider)).toBe(expected);
  });
});
