import { describe, expect, it } from "vitest";
import {
  extractUploadKeysFromText,
  isJobFileKey,
  isManagedUploadKey,
  tryParseUploadKey,
} from "../src/index.js";

describe("tryParseUploadKey", () => {
  it("parses org, theme, and event layouts", () => {
    const org = "default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png";
    expect(tryParseUploadKey(`/uploads/${org}`)).toBe(org);
    expect(tryParseUploadKey(org)).toBe(org);
    expect(tryParseUploadKey(`uploads/${org}`)).toBe(org);

    const theme = "default/theme/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.woff2";
    expect(tryParseUploadKey(`/uploads/${theme}`)).toBe(theme);

    const event = "default/events/evt-1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg";
    expect(tryParseUploadKey(`/uploads/${event}`)).toBe(event);
  });

  it("rejects external URLs, empties, and escapes", () => {
    expect(tryParseUploadKey("")).toBeNull();
    expect(tryParseUploadKey("https://cdn.example.com/logo.png")).toBeNull();
    expect(tryParseUploadKey("/uploads/../etc/passwd")).toBeNull();
    expect(tryParseUploadKey("/uploads/default/not-a-uuid.png")).toBeNull();
    expect(tryParseUploadKey("/uploads/default/x.png?x=1")).toBeNull();
    expect(tryParseUploadKey("/uploads/default/x.png#h")).toBeNull();
    expect(isManagedUploadKey("default/readme.txt")).toBe(false);
    expect(isManagedUploadKey("")).toBe(false);
    expect(isManagedUploadKey("/default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png")).toBe(false);
    expect(isManagedUploadKey("default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png/")).toBe(false);
    expect(isManagedUploadKey("default//aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png")).toBe(false);
    expect(isManagedUploadKey("a/b/c/d")).toBe(false);
    expect(isManagedUploadKey("default/other/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png")).toBe(false);
    expect(isManagedUploadKey("default/events/../aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png")).toBe(
      false,
    );
  });
});

describe("extractUploadKeysFromText", () => {
  it("finds managed paths inside HTML template bodies", () => {
    const key = "default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png";
    const html = `<img src="/uploads/${key}" alt="x"> and again /uploads/${key} trailing`;
    expect(extractUploadKeysFromText(html)).toEqual([key, key]);
  });

  it("returns empty for blank text and ignores non-managed matches", () => {
    expect(extractUploadKeysFromText("")).toEqual([]);
    expect(extractUploadKeysFromText("no uploads here")).toEqual([]);
    // Regex can match a loose uuid-ish token that still fails the strict filename pattern.
    expect(
      extractUploadKeysFromText("/uploads/default/------------------------------------.png"),
    ).toEqual([]);
  });

  it("stays fast on a very long text of near-miss upload paths and still finds the real one", () => {
    const key = "default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png";
    const hostile = `${"/uploads/".repeat(50_000)}/uploads/${key}`;
    const started = performance.now();

    expect(extractUploadKeysFromText(hostile)).toEqual([key]);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("isJobFileKey", () => {
  const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it.each([".csv", ".xlsx", ".pdf"])("accepts a file of an export or an import in the event layout (%s)", (ext) => {
    expect(isJobFileKey(`org-1/events/evt-1/${uuid}${ext}`)).toBe(true);
  });

  it("rejects branding uploads, other layouts, other names and anything that escapes the upload root", () => {
    const rejected = [
      `org-1/events/evt-1/${uuid}.png`,
      `org-1/events/evt-1/${uuid}.CSV`,
      `org-1/events/evt-1/${uuid}.csv.bak`,
      "org-1/events/evt-1/report.csv",
      `org-1/${uuid}.csv`,
      `org-1/theme/${uuid}.csv`,
      `org-1/events/${uuid}.csv`,
      `org-1/events/evt-1/old/${uuid}.csv`,
      `org-1/events/evt-1/${uuid}.csv/extra`,
      `org-1/other/evt-1/${uuid}.csv`,
      `Org-1/events/evt-1/${uuid}.csv`,
      `/org-1/events/evt-1/${uuid}.csv`,
      `org-1/events/evt-1/${uuid}.csv/`,
      `org-1//events/evt-1/${uuid}.csv`,
      `org-1/events/../${uuid}.csv`,
      `org-1\\events\\evt-1\\${uuid}.csv`,
      "",
    ];
    for (const key of rejected) expect(isJobFileKey(key), key).toBe(false);
  });

  it("never accepts a key that isManagedUploadKey accepts, and the other way round", () => {
    for (const ext of [".png", ".woff2", ".csv", ".xlsx", ".pdf"]) {
      const key = `org-1/events/evt-1/${uuid}${ext}`;
      expect(isJobFileKey(key) && isManagedUploadKey(key), key).toBe(false);
      expect(isJobFileKey(key) || isManagedUploadKey(key), key).toBe(true);
    }
  });
});
