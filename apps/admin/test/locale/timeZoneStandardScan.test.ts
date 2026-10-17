import { describe, expect, it } from "vitest";
import { scanTimeZones, type Rule } from "./timeZoneStandardScan.js";

const FILE = "apps/admin/src/pages/Example.tsx";
const scan = (source: string, rule: Rule, file = FILE) => scanTimeZones({ [file]: source })[rule];
const only = (count: number, file = FILE) => (count === 0 ? {} : { [file]: count });
const IMPORT = 'import { getBrowserTimeZone } from "../utils/event-dates.js";\n';

describe("time-zone-standard scanner: the viewer's zone is read", () => {
  it("counts each call of getBrowserTimeZone", () => {
    expect(scan(`${IMPORT}const a = getBrowserTimeZone();`, "viewer-zone-read")).toEqual(only(1));
    expect(scan(`${IMPORT}const a = f(x, getBrowserTimeZone()); const b = getBrowserTimeZone();`, "viewer-zone-read")).toEqual(only(2));
    expect(scan(`${IMPORT}const el = <time>{fmt(iso, getBrowserTimeZone())}</time>;`, "viewer-zone-read")).toEqual(only(1));
  });

  it("counts the helper when it is passed on or kept under another name, not only when it is called", () => {
    expect(scan(`${IMPORT}const zoneOf = getBrowserTimeZone;`, "viewer-zone-read")).toEqual(only(1));
    expect(scan(`${IMPORT}const zone = useMemo(getBrowserTimeZone, []);`, "viewer-zone-read")).toEqual(only(1));
    expect(scan('import { getBrowserTimeZone as tz } from "../utils/event-dates.js"; const a = tz();', "viewer-zone-read")).toEqual(only(1));
    expect(scan('import * as dates from "../utils/event-dates.js"; const a = dates.getBrowserTimeZone();', "viewer-zone-read")).toEqual(only(1));
  });

  it("counts every resolvedOptions() call, in any spelling, since that is how the browser's own zone is read", () => {
    for (const source of [
      "const z = Intl.DateTimeFormat().resolvedOptions().timeZone;",
      "const z = new Intl.DateTimeFormat().resolvedOptions().timeZone;",
      'const z = new Intl.DateTimeFormat("en-GB").resolvedOptions().timeZone || "UTC";',
      "const { timeZone } = Intl.DateTimeFormat().resolvedOptions();",
      "const options = Intl.DateTimeFormat().resolvedOptions(); const z = options.timeZone;",
      'const z = Intl.DateTimeFormat().resolvedOptions()["timeZone"];',
      "const l = Intl.DateTimeFormat().resolvedOptions().locale;",
    ]) {
      expect(scan(source, "viewer-zone-read")).toEqual(only(1));
    }
  });

  it("does not count a zone that was handed in, a mention in a comment or a string, or an import that is never used", () => {
    expect(scan("const z = options.timeZone;", "viewer-zone-read")).toEqual({});
    expect(scan('// getBrowserTimeZone() was used here\nconst s = "Intl.DateTimeFormat().resolvedOptions().timeZone";', "viewer-zone-read")).toEqual({});
    expect(scan(IMPORT, "viewer-zone-read")).toEqual({});
    expect(scan("/** viewerLocalTime(iso) and getBrowserTimeZone() */ const x = 1;", "viewer-zone-read")).toEqual({});
  });

  it("skips the files that implement the rule: the date helpers and the request module", () => {
    for (const file of ["apps/admin/src/utils/event-dates.ts", "apps/admin/src/api/client.ts"]) {
      const source = "export const z = Intl.DateTimeFormat().resolvedOptions().timeZone; const t = viewerLocalTime(iso); const f = new Intl.DateTimeFormat('en-GB').format(d);";
      expect(scanTimeZones({ [file]: source })).toEqual({ "viewer-zone-read": {}, "viewer-local-time": {}, "implicit-zone-format": {}, "zone-fallback-not-utc": {} });
    }
  });
});

describe("time-zone-standard scanner: viewerLocalTime", () => {
  it("counts each use, per file, also under another name", () => {
    expect(scan("const a = viewerLocalTime(x); const b = viewerLocalTime(y);", "viewer-local-time")).toEqual(only(2));
    expect(scan('import { viewerLocalTime as mine } from "../utils/event-dates.js"; const a = mine(x);', "viewer-local-time")).toEqual(only(1));
    const other = "apps/admin/src/components/Other.tsx";
    expect(scanTimeZones({ [FILE]: "viewerLocalTime(x);", [other]: "viewerLocalTime(x);" })["viewer-local-time"]).toEqual({ [FILE]: 1, [other]: 1 });
  });

  it("does not count a function that only has the name in it", () => {
    expect(scan("const a = viewerLocalTimeText(x);", "viewer-local-time")).toEqual({});
    expect(scan("const a = obj.viewerLocalTimeText;", "viewer-local-time")).toEqual({});
  });
});

describe("time-zone-standard scanner: a format with no zone", () => {
  it("counts an Intl.DateTimeFormat with no timeZone option, however it is built", () => {
    for (const source of [
      'const f = new Intl.DateTimeFormat("en-GB", { day: "2-digit" });',
      'const f = Intl.DateTimeFormat("en-GB");',
      "const f = new Intl.DateTimeFormat();",
      'const f = new Intl.DateTimeFormat("en-GB", options);',
    ]) {
      expect(scan(source, "implicit-zone-format")).toEqual(only(1));
    }
  });

  it("does not count an Intl.DateTimeFormat that names a zone, or may through a spread", () => {
    for (const source of [
      'const f = new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "UTC" });',
      'const f = new Intl.DateTimeFormat("en-GB", { timeZone });',
      'const f = new Intl.DateTimeFormat("en-GB", { "timeZone": zone });',
      'const f = new Intl.DateTimeFormat("en-GB", { ...base, day: "2-digit" });',
    ]) {
      expect(scan(source, "implicit-zone-format")).toEqual({});
    }
  });

  it("does not count an Intl.DateTimeFormat that is only built to read its resolved options (the read rule counts that)", () => {
    expect(scan('const h = Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;', "implicit-zone-format")).toEqual({});
    expect(scan('const h = Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;', "viewer-zone-read")).toEqual(only(1));
  });

  it("counts toLocaleDateString and toLocaleTimeString with no timeZone option, but not toLocaleString, which numbers have too", () => {
    expect(scan('const s = d.toLocaleDateString("en-GB", { day: "numeric" });', "implicit-zone-format")).toEqual(only(1));
    expect(scan("const s = d.toLocaleTimeString();", "implicit-zone-format")).toEqual(only(1));
    expect(scan('const s = d.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" });', "implicit-zone-format")).toEqual({});
    expect(scan("const s = count.toLocaleString();", "implicit-zone-format")).toEqual({});
  });
});

describe("time-zone-standard scanner: a zone that falls back to something other than UTC", () => {
  it("counts a ?? or || fallback in the zone argument of a time helper, at the position that helper takes it", () => {
    expect(scan("const s = formatEventDateTime(iso, entryZone ?? eventZone);", "zone-fallback-not-utc")).toEqual(only(1));
    expect(scan("const s = formatEventTime(iso, entry.zone || event.timezone);", "zone-fallback-not-utc")).toEqual(only(1));
    expect(scan("const s = formatAdmissionDisplay(iso, day, entryZone ?? eventZone);", "zone-fallback-not-utc")).toEqual(only(1));
    expect(scan("const s = formatRelativeAdmissionDisplay(iso, day, a ?? b);", "zone-fallback-not-utc")).toEqual(only(1));
  });

  it("counts formatActorTime too, and a fallback hidden in front of a final UTC", () => {
    expect(scan("const s = formatActorTime(iso, actorZone ?? eventZone);", "zone-fallback-not-utc")).toEqual(only(1));
    expect(scan('const s = formatEventDateTime(iso, a ?? b ?? "UTC");', "zone-fallback-not-utc")).toEqual(only(1));
    expect(scan("const s = formatEventDateTime(iso, a || (b ?? c));", "zone-fallback-not-utc")).toEqual(only(1));
  });

  it("does not count a fallback to UTC, to undefined or to null, a plain zone, or the same expression in another function", () => {
    expect(scan('const s = formatEventDateTime(iso, entryZone ?? "UTC");', "zone-fallback-not-utc")).toEqual({});
    expect(scan("const s = formatActorTime(iso, entryZone ?? undefined);", "zone-fallback-not-utc")).toEqual({});
    expect(scan("const s = formatEventTime(iso, entryZone || undefined);", "zone-fallback-not-utc")).toEqual({});
    expect(scan("const s = formatEventTime(iso, entryZone ?? null);", "zone-fallback-not-utc")).toEqual({});
    expect(scan("const s = formatEventDateTime(iso, zone);", "zone-fallback-not-utc")).toEqual({});
    expect(scan("const s = formatEventDateTime(a ?? b, zone);", "zone-fallback-not-utc")).toEqual({});
    expect(scan("const s = somethingElse(iso, entryZone ?? eventZone);", "zone-fallback-not-utc")).toEqual({});
  });
});

describe("time-zone-standard scanner: input", () => {
  it("parses TypeScript and TSX, and says which file it could not read", () => {
    expect(scan(`${IMPORT}const z: string = getBrowserTimeZone() as string;`, "viewer-zone-read", "apps/admin/src/utils/zone.ts")).toEqual({
      "apps/admin/src/utils/zone.ts": 1,
    });
    expect(() => scan("const = ;", "viewer-zone-read")).toThrow(/could not parse apps\/admin\/src\/pages\/Example\.tsx/);
  });
});
