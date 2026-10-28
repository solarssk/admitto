import { describe, expect, it } from "vitest";
import {
  accessMethodsDirty,
  accessMethodsDraftFrom,
  buildAccessMethodsSaveBody,
  type AccessMethodsDraft,
} from "../../src/settings/registrationAccessMethods.js";
import { accessMethodsDto } from "./accessMethodsFixtures.js";

const draft = (overrides: Partial<AccessMethodsDraft> = {}): AccessMethodsDraft => ({ link: false, password: false, ...overrides });

describe("accessMethodsDraftFrom", () => {
  it("is off for both switches when the server has no way on", () => {
    expect(accessMethodsDraftFrom(accessMethodsDto())).toEqual({ link: false, password: false });
  });

  it("follows the way that the server has on, not whether a guest can use it", () => {
    expect(accessMethodsDraftFrom(accessMethodsDto(["link"], false))).toEqual({ link: true, password: false });
    expect(accessMethodsDraftFrom(accessMethodsDto(["link", "password"]))).toEqual({ link: true, password: true });
  });

  it("is off for a switch whose way the server leaves out of its answer", () => {
    expect(accessMethodsDraftFrom({ methods: [] })).toEqual({ link: false, password: false });
  });
});

describe("accessMethodsDirty", () => {
  it("is false for the saved draft and true for either switch turned", () => {
    expect(accessMethodsDirty(draft(), draft())).toBe(false);
    expect(accessMethodsDirty(draft({ link: true }), draft())).toBe(true);
    expect(accessMethodsDirty(draft({ password: true }), draft())).toBe(true);
    expect(accessMethodsDirty(draft({ link: true }), draft({ link: true }))).toBe(false);
  });
});

describe("buildAccessMethodsSaveBody", () => {
  it("is null when no switch changed, even when the server has a way that the card does not show", () => {
    expect(buildAccessMethodsSaveBody(draft(), draft(), accessMethodsDto())).toBeNull();
    expect(buildAccessMethodsSaveBody(draft({ link: true }), draft({ link: true }), accessMethodsDto(["link", "sso"]))).toBeNull();
  });

  it("lists the ways that are on, the link first", () => {
    expect(buildAccessMethodsSaveBody(draft({ link: true }), draft(), accessMethodsDto())).toEqual({ methods: ["link"] });
    expect(buildAccessMethodsSaveBody(draft({ link: true, password: true }), draft(), accessMethodsDto())).toEqual({
      methods: ["link", "password"],
    });
  });

  it("lists nothing when the last way is turned off, since the server replaces the whole list", () => {
    expect(buildAccessMethodsSaveBody(draft(), draft({ password: true }), accessMethodsDto(["password"]))).toEqual({ methods: [] });
  });

  it("keeps the ways that the card has no switch for and the server has on", () => {
    expect(buildAccessMethodsSaveBody(draft({ link: true }), draft(), accessMethodsDto(["sso"]))).toEqual({ methods: ["link", "sso"] });
    expect(buildAccessMethodsSaveBody(draft(), draft({ link: true }), accessMethodsDto(["link", "sso"]))).toEqual({ methods: ["sso"] });
  });

  it("does not carry a way that the card switches from the answer of the server, only from the draft", () => {
    expect(buildAccessMethodsSaveBody(draft({ password: true }), draft({ link: true }), accessMethodsDto(["link"]))).toEqual({
      methods: ["password"],
    });
  });
});
