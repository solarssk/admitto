import { describe, expect, it } from "vitest";
import {
  isOptionalIpv6LoopbackBindError,
  resolveDevServeHostname,
  resolveDevServeHostnames,
} from "../../src/index.js";

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

describe("isOptionalIpv6LoopbackBindError", () => {
  it("ignores non-optional listeners", () => {
    expect(
      isOptionalIpv6LoopbackBindError(false, { code: "EAFNOSUPPORT" } as NodeJS.ErrnoException),
    ).toBe(false);
  });

  it("treats EAFNOSUPPORT / EADDRNOTAVAIL as soft failures on ::1", () => {
    expect(
      isOptionalIpv6LoopbackBindError(true, { code: "EAFNOSUPPORT" } as NodeJS.ErrnoException),
    ).toBe(true);
    expect(
      isOptionalIpv6LoopbackBindError(true, { code: "EADDRNOTAVAIL" } as NodeJS.ErrnoException),
    ).toBe(true);
  });

  it("does not soft-fail other errors on ::1", () => {
    expect(
      isOptionalIpv6LoopbackBindError(true, { code: "EADDRINUSE" } as NodeJS.ErrnoException),
    ).toBe(false);
  });
});
