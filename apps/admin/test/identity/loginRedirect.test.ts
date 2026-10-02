// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { orLoginRedirect, redirectToLogin } from "../../src/identity/loginRedirect.js";

const assign = vi.fn();
const original = Object.getOwnPropertyDescriptor(window, "location");

function stubLocation() {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname: "/admin/settings/identity/providers", assign },
  });
}

afterEach(() => {
  assign.mockClear();
  if (original) Object.defineProperty(window, "location", original);
});

describe("redirectToLogin", () => {
  it("sends the browser to the login page with the path to come back to", () => {
    stubLocation();
    redirectToLogin();
    expect(assign).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fsettings%2Fidentity%2Fproviders");
  });
});

describe("orLoginRedirect", () => {
  it("passes the answer, and the signal, through", async () => {
    const load = vi.fn((_signal: AbortSignal) => Promise.resolve(["a"]));
    const signal = new AbortController().signal;
    await expect(orLoginRedirect(load)(signal)).resolves.toEqual(["a"]);
    expect(load).toHaveBeenCalledWith(signal);
    expect(assign).not.toHaveBeenCalled();
  });

  it("hands a 401 over to the login page and never answers, so no error flashes up first", async () => {
    stubLocation();
    let settled = false;
    const result = orLoginRedirect(() => Promise.reject(new ApiError(401, "authentication_required")))(new AbortController().signal);
    void result.then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(assign).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
  });

  it("rethrows every other failure, an ApiError included", async () => {
    stubLocation();
    const failure = new ApiError(500, "boom");
    await expect(orLoginRedirect(() => Promise.reject(failure))(new AbortController().signal)).rejects.toBe(failure);
    const plain = new Error("network down");
    await expect(orLoginRedirect(() => Promise.reject(plain))(new AbortController().signal)).rejects.toBe(plain);
    expect(assign).not.toHaveBeenCalled();
  });
});
