import { describe, expect, it } from "vitest";
import { generateCodeVerifier, codeChallengeS256 } from "../src/oidc/pkce.js";

describe("oidc pkce", () => {
  it("generates verifier and matching S256 challenge", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const challenge = codeChallengeS256(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    const challenge2 = codeChallengeS256(verifier);
    expect(challenge2).toBe(challenge);
  });
});
