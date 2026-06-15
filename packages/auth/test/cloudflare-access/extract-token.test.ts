import { describe, expect, it } from "vitest";
import {
  CF_ACCESS_COOKIE,
  CF_ACCESS_HEADER,
  extractAccessTokenFromHeaders,
} from "../../src/cloudflare-access/extract-token.js";

describe("extractAccessTokenFromHeaders", () => {
  it("prefers Cf-Access-Jwt-Assertion header", () => {
    const token = extractAccessTokenFromHeaders({
      [CF_ACCESS_HEADER]: "header.jwt",
      [CF_ACCESS_COOKIE]: "cookie.jwt",
    });
    expect(token).toBe("header.jwt");
  });

  it("ignores CF_Authorization cookie when header is absent", () => {
    const token = extractAccessTokenFromHeaders({
      [CF_ACCESS_COOKIE]: "cookie.jwt",
    });
    expect(token).toBeNull();
  });
});
