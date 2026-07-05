// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildCfUpdateBody,
  cfDraftFromSummary,
  emptyCfDraft,
  isCfDraftDirty,
  joinListInput,
  parseListInput,
  validateCfDraft,
} from "../../src/identity/cfAccessValidation.js";
import type { CfAccessSummaryDto } from "../../src/api/types.js";

const noLocks = { enabled: false, teamDomain: false, audience: false, protectedPrefixes: false };

function summary(over: Partial<CfAccessSummaryDto> = {}): CfAccessSummaryDto {
  return {
    enabled: false,
    teamDomain: "",
    audience: [],
    protectedPrefixes: [],
    locks: noLocks,
    ...over,
  };
}

describe("cfAccessValidation", () => {
  it("parseListInput splits, trims, drops empties, and de-duplicates", () => {
    expect(parseListInput(" /admin ,  /api/admin , , ")).toEqual(["/admin", "/api/admin"]);
    expect(parseListInput("")).toEqual([]);
    expect(parseListInput("aud-1, aud-1, aud-2")).toEqual(["aud-1", "aud-2"]);
  });

  it("joinListInput round-trips through parseListInput", () => {
    const values = ["/admin", "/api/admin"];
    expect(parseListInput(joinListInput(values))).toEqual(values);
  });

  it("emptyCfDraft starts clean and cfDraftFromSummary seeds from the DTO", () => {
    expect(emptyCfDraft().enabled).toBe(false);
    const d = cfDraftFromSummary(
      summary({ enabled: true, teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }),
    );
    expect(d).toEqual({
      enabled: true,
      teamDomain: "https://t",
      audienceRaw: "a",
      protectedPrefixesRaw: "/admin",
    });
  });

  it("isCfDraftDirty is false for an unchanged draft and true for any field change", () => {
    const base = cfDraftFromSummary(
      summary({ teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }),
    );
    expect(isCfDraftDirty(base, base)).toBe(false);
    expect(isCfDraftDirty({ ...base, enabled: true }, base)).toBe(true);
    expect(isCfDraftDirty({ ...base, teamDomain: "https://t " }, base)).toBe(false); // trimmed equality
    // A trailing comma in the raw text is not a semantic change.
    expect(isCfDraftDirty({ ...base, audienceRaw: "a, " }, base)).toBe(false);
    expect(isCfDraftDirty({ ...base, audienceRaw: "a, b" }, base)).toBe(true);
    expect(isCfDraftDirty({ ...base, protectedPrefixesRaw: "/admin, /x" }, base)).toBe(true);
  });

  it("validateCfDraft flags missing team domain + audience when enabled", () => {
    const errors = validateCfDraft({
      enabled: true,
      teamDomain: "",
      audienceRaw: "",
      protectedPrefixesRaw: "/admin",
    });
    expect(errors.teamDomain).toMatch(/Team URL is required/);
    expect(errors.audience).toMatch(/AUD/);
    expect(errors.protectedPrefixes).toBeUndefined();
  });

  it("validateCfDraft rejects a team URL with a non-https scheme but accepts a schemeless host (server parity)", () => {
    // http:// is rejected inline.
    const httpScheme = validateCfDraft({
      enabled: true,
      teamDomain: "http://team.cloudflareaccess.com",
      audienceRaw: "a",
      protectedPrefixesRaw: "/admin",
    });
    expect(httpScheme.teamDomain).toMatch(/https/);

    // Other schemes are rejected too.
    const ftpScheme = validateCfDraft({
      enabled: true,
      teamDomain: "ftp://team.cloudflareaccess.com",
      audienceRaw: "a",
      protectedPrefixesRaw: "/admin",
    });
    expect(ftpScheme.teamDomain).toMatch(/https/);

    // Schemeless host is accepted — the server normalizer prepends https://, so
    // an env-locked schemeless team domain must not block an otherwise-valid save.
    const schemeless = validateCfDraft({
      enabled: true,
      teamDomain: "team.cloudflareaccess.com",
      audienceRaw: "a",
      protectedPrefixesRaw: "/admin",
    });
    expect(schemeless.teamDomain).toBeUndefined();
  });

  it("validateCfDraft flags a protected prefix that does not start with /", () => {
    const errors = validateCfDraft({
      enabled: false,
      teamDomain: "",
      audienceRaw: "",
      protectedPrefixesRaw: "admin",
    });
    expect(errors.protectedPrefixes).toMatch(/start with \//);
  });

  it("validateCfDraft passes a valid enabled config", () => {
    const errors = validateCfDraft({
      enabled: true,
      teamDomain: "https://team.cloudflareaccess.com",
      audienceRaw: "a",
      protectedPrefixesRaw: "/admin",
    });
    expect(errors).toEqual({});
  });

  it("buildCfUpdateBody includes unlocked fields (parsed) and omits locked ones", () => {
    const draft = {
      enabled: true,
      teamDomain: "https://t",
      audienceRaw: "a, b",
      protectedPrefixesRaw: "/admin, /api/admin",
    };
    const body = buildCfUpdateBody(draft, {
      enabled: true,
      teamDomain: false,
      audience: false,
      protectedPrefixes: false,
    });
    expect(body).toEqual({
      teamDomain: "https://t",
      audience: ["a", "b"],
      protectedPrefixes: ["/admin", "/api/admin"],
    });
    expect(body.enabled).toBeUndefined();
  });

  it("buildCfUpdateBody omits every field when all are locked", () => {
    const body = buildCfUpdateBody(
      { enabled: true, teamDomain: "https://t", audienceRaw: "a", protectedPrefixesRaw: "/admin" },
      { enabled: true, teamDomain: true, audience: true, protectedPrefixes: true },
    );
    expect(body).toEqual({});
  });
});
