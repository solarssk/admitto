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
  it("parseListInput splits, trims, drops empties", () => {
    expect(parseListInput(" /admin ,  /api/admin , , ")).toEqual(["/admin", "/api/admin"]);
    expect(parseListInput("")).toEqual([]);
  });

  it("joinListInput round-trips through parseListInput", () => {
    const values = ["/admin", "/api/admin"];
    expect(parseListInput(joinListInput(values))).toEqual(values);
  });

  it("emptyCfDraft starts clean and cfDraftFromSummary seeds from the DTO", () => {
    expect(emptyCfDraft().enabled).toBe(false);
    const d = cfDraftFromSummary(summary({ enabled: true, teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }));
    expect(d).toEqual({ enabled: true, teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] });
  });

  it("isCfDraftDirty is false for an unchanged draft and true for any field change", () => {
    const base = cfDraftFromSummary(summary({ teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }));
    expect(isCfDraftDirty(base, base)).toBe(false);
    expect(isCfDraftDirty({ ...base, enabled: true }, base)).toBe(true);
    expect(isCfDraftDirty({ ...base, teamDomain: "https://t " }, base)).toBe(false); // trimmed equality
    expect(isCfDraftDirty({ ...base, audience: ["a", "b"] }, base)).toBe(true);
    expect(isCfDraftDirty({ ...base, protectedPrefixes: ["/admin", "/x"] }, base)).toBe(true);
  });

  it("validateCfDraft flags missing team domain + audience when enabled", () => {
    const errors = validateCfDraft({ enabled: true, teamDomain: "", audience: [], protectedPrefixes: ["/admin"] });
    expect(errors.teamDomain).toMatch(/Team URL is required/);
    expect(errors.audience).toMatch(/AUD/);
    expect(errors.protectedPrefixes).toBeUndefined();
  });

  it("validateCfDraft flags a team domain without an http(s) scheme", () => {
    const errors = validateCfDraft({ enabled: true, teamDomain: "team.cloudflareaccess.com", audience: ["a"], protectedPrefixes: ["/admin"] });
    expect(errors.teamDomain).toMatch(/http/);
  });

  it("validateCfDraft flags a protected prefix that does not start with /", () => {
    const errors = validateCfDraft({ enabled: false, teamDomain: "", audience: [], protectedPrefixes: ["admin"] });
    expect(errors.protectedPrefixes).toMatch(/start with \//);
  });

  it("validateCfDraft passes a valid enabled config", () => {
    const errors = validateCfDraft({ enabled: true, teamDomain: "https://team.cloudflareaccess.com", audience: ["a"], protectedPrefixes: ["/admin"] });
    expect(errors).toEqual({});
  });

  it("buildCfUpdateBody includes unlocked fields and omits locked ones", () => {
    const draft = { enabled: true, teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] };
    const body = buildCfUpdateBody(draft, { enabled: true, teamDomain: false, audience: false, protectedPrefixes: false });
    expect(body).toEqual({ teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] });
    expect(body.enabled).toBeUndefined();
  });

  it("buildCfUpdateBody omits every field when all are locked", () => {
    const body = buildCfUpdateBody(
      { enabled: true, teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] },
      { enabled: true, teamDomain: true, audience: true, protectedPrefixes: true },
    );
    expect(body).toEqual({});
  });
});
