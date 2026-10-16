// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { goToLogin } from "../../src/auth/login-navigation.js";
import { clearSignOutInProgress, markSignOutInProgress } from "../../src/auth/sign-out-in-progress.js";

describe("goToLogin", () => {
  const assign = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("location", { assign });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearSignOutInProgress();
    assign.mockClear();
  });

  it("sends the browser to the address it is given", () => {
    goToLogin("/login?next=%2Fadmin");

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/login?next=%2Fadmin");
  });

  it("stays where it is while the user's Sign out is under way, so the trip to the identity provider is not replaced", () => {
    markSignOutInProgress();

    goToLogin("/login?next=%2Fadmin");

    expect(assign).not.toHaveBeenCalled();
  });

  it("goes again once the Sign out is over (it failed)", () => {
    markSignOutInProgress();
    clearSignOutInProgress();

    goToLogin("/login");

    expect(assign).toHaveBeenCalledWith("/login");
  });
});
