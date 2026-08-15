import { describe, expect, it } from "vitest";
import { ExternalIdentityLinkError } from "../../src/external-identity/resolve-user.js";
import { extractCfAccessSourceSubject } from "../../src/cloudflare-access/resolve-identity.js";

describe("extractCfAccessSourceSubject", () => {
  it("accepts an opaque canonical subject copied into the verified Access JWT", () => {
    expect(
      extractCfAccessSourceSubject({
        custom: { admitto_identity: "9ea48257-8f5c-4b66-831b-207e2d3e9b16" },
      }),
    ).toBe("9ea48257-8f5c-4b66-831b-207e2d3e9b16");
  });

  it.each([
    [{}, "missing custom claim"],
    [{ custom: {} }, "missing identity value"],
    [{ custom: { admitto_identity: "" } }, "empty identity value"],
    [{ custom: { admitto_identity: "identity@example.com" } }, "email identity value"],
    [{ custom: { admitto_identity: ["not-a-subject"] } }, "non-string identity value"],
  ])("rejects %s", (payload) => {
    expect(() => extractCfAccessSourceSubject(payload)).toThrow(ExternalIdentityLinkError);
  });
});
