import { describe, expect, it } from "vitest";
import { resolveDevServeHostname, resolveDevServeHostnames } from "../../src/index.js";

describe("resolveDevServeHostnames", () => {
  it("binds both loopback families in HTTP-only development", () => {
    expect(resolveDevServeHostnames(true, false)).toEqual(["127.0.0.1", "::1"]);
  });

  it("does not force a hostname when serving local HTTPS (LAN camera testing)", () => {
    expect(resolveDevServeHostnames(true, true)).toBeUndefined();
  });

  it("does not force a hostname outside development", () => {
    expect(resolveDevServeHostnames(false, false)).toBeUndefined();
    expect(resolveDevServeHostnames(false, true)).toBeUndefined();
  });
});

describe("resolveDevServeHostname", () => {
  it("returns the IPv4 loopback for HTTP-only development", () => {
    expect(resolveDevServeHostname(true, false)).toBe("127.0.0.1");
  });
});
