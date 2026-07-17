import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import {
  isBlockedPrivateOrMetadataHost,
  isLoopbackHost,
  resolveSafeHostname,
  unbracketHostname,
} from "../src/ssrfGuard.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

beforeEach(() => {
  mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as Awaited<
    ReturnType<typeof lookup>
  >);
});

describe("unbracketHostname", () => {
  it("strips brackets from an IPv6 literal", () => {
    expect(unbracketHostname("[::1]")).toBe("::1");
  });

  it("leaves a plain hostname untouched", () => {
    expect(unbracketHostname("example.com")).toBe("example.com");
  });
});

describe("isLoopbackHost", () => {
  it("recognizes localhost, 127.0.0.1, and ::1", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
  });

  it("recognizes IPv4-mapped IPv6 loopback", () => {
    expect(isLoopbackHost("::ffff:127.0.0.1")).toBe(true);
  });

  it("does not flag a public hostname", () => {
    expect(isLoopbackHost("example.com")).toBe(false);
  });
});

describe("isBlockedPrivateOrMetadataHost", () => {
  it("blocks cloud metadata host and IP", () => {
    expect(isBlockedPrivateOrMetadataHost("metadata.google.internal")).toBe(true);
    expect(isBlockedPrivateOrMetadataHost("169.254.169.254")).toBe(true);
  });

  it("blocks RFC1918 ranges", () => {
    expect(isBlockedPrivateOrMetadataHost("10.0.0.1")).toBe(true);
    expect(isBlockedPrivateOrMetadataHost("172.16.0.1")).toBe(true);
    expect(isBlockedPrivateOrMetadataHost("192.168.1.1")).toBe(true);
  });

  it("blocks unspecified addresses", () => {
    expect(isBlockedPrivateOrMetadataHost("0.0.0.0")).toBe(true);
    expect(isBlockedPrivateOrMetadataHost("::")).toBe(true);
  });

  it("blocks private IPv6 (link-local and unique-local)", () => {
    expect(isBlockedPrivateOrMetadataHost("fe80::1")).toBe(true);
    expect(isBlockedPrivateOrMetadataHost("fd00::1")).toBe(true);
  });

  it("blocks IPv4-mapped private IPv6 literals", () => {
    expect(isBlockedPrivateOrMetadataHost("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedPrivateOrMetadataHost("::ffff:7f00:1")).toBe(true);
  });

  it("allows a public hostname/IP", () => {
    expect(isBlockedPrivateOrMetadataHost("example.com")).toBe(false);
    expect(isBlockedPrivateOrMetadataHost("93.184.216.34")).toBe(false);
  });
});

describe("resolveSafeHostname", () => {
  it("allows a hostname that resolves to a public address", async () => {
    await expect(resolveSafeHostname("example.com")).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  it("rejects a hostname that resolves to a private address", async () => {
    mockedLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as Awaited<
      ReturnType<typeof lookup>
    >);
    await expect(resolveSafeHostname("evil.example.com")).rejects.toThrow(/private or link-local/);
  });

  it("rejects a hostname that resolves to an unspecified address", async () => {
    mockedLookup.mockResolvedValue([{ address: "0.0.0.0", family: 4 }] as Awaited<
      ReturnType<typeof lookup>
    >);
    await expect(resolveSafeHostname("evil.example.com")).rejects.toThrow(/private or link-local/);
  });

  it("rejects a literal private IP without a DNS lookup", async () => {
    mockedLookup.mockClear();
    await expect(resolveSafeHostname("127.0.0.1")).rejects.toThrow(/private or link-local/);
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("rejects when DNS resolution fails", async () => {
    mockedLookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(resolveSafeHostname("nowhere.invalid")).rejects.toThrow(/could not be resolved/);
  });
});
