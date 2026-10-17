import { describe, expect, it } from "vitest";
import { scanTimeZones } from "./timeZoneStandardScan.js";

const FILE = "apps/admin/src/pages/Example.tsx";
const scan = (source: string, file = FILE) => scanTimeZones({ [file]: source });
const only = (count: number, file = FILE) => (count === 0 ? {} : { [file]: count });

describe("time-zone-standard scanner: the viewer's zone is read", () => {
  it("counts each call of getBrowserTimeZone", () => {
    expect(scan('import { getBrowserTimeZone } from "../utils/event-dates.js"; const a = getBrowserTimeZone();')["viewer-zone-read"]).toEqual(only(1));
    expect(scan("const a = f(x, getBrowserTimeZone()); const b = getBrowserTimeZone();")["viewer-zone-read"]).toEqual(only(2));
    expect(scan("const el = <time>{fmt(iso, getBrowserTimeZone())}</time>;")["viewer-zone-read"]).toEqual(only(1));
  });

  it("counts the browser's own zone read from Intl, in any spelling of the constructor", () => {
    for (const source of [
      "const z = Intl.DateTimeFormat().resolvedOptions().timeZone;",
      "const z = new Intl.DateTimeFormat().resolvedOptions().timeZone;",
      'const z = new Intl.DateTimeFormat("en-GB").resolvedOptions().timeZone || "UTC";',
      "const z = Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().timeZone;",
    ]) {
      expect(scan(source)["viewer-zone-read"]).toEqual(only(1));
    }
  });

  it("counts a zone taken out of the resolved options by destructuring, also renamed", () => {
    expect(scan("const { timeZone } = Intl.DateTimeFormat().resolvedOptions();")["viewer-zone-read"]).toEqual(only(1));
    expect(scan("const { timeZone: tz } = new Intl.DateTimeFormat().resolvedOptions();")["viewer-zone-read"]).toEqual(only(1));
  });

  it("does not count other things the resolved options hold, or a zone that was handed in", () => {
    expect(scan("const l = Intl.DateTimeFormat().resolvedOptions().locale;")["viewer-zone-read"]).toEqual({});
    expect(scan("const { locale } = Intl.DateTimeFormat().resolvedOptions();")["viewer-zone-read"]).toEqual({});
    expect(scan("const z = options.timeZone;")["viewer-zone-read"]).toEqual({});
    expect(scan("const z = props.format.resolvedOptions.timeZone;")["viewer-zone-read"]).toEqual({});
  });

  it("does not count a mention in a comment or a string, or an import that is never called", () => {
    expect(scan('// getBrowserTimeZone() was used here\nconst s = "Intl.DateTimeFormat().resolvedOptions().timeZone";')["viewer-zone-read"]).toEqual({});
    expect(scan('import { getBrowserTimeZone } from "../utils/event-dates.js";')["viewer-zone-read"]).toEqual({});
    expect(scan("/** viewerLocalTime(iso) and getBrowserTimeZone() */ const x = 1;")).toEqual({ "viewer-zone-read": {}, "viewer-local-time": {} });
  });

  it("skips the files that implement the rule: the date helpers and the request module", () => {
    for (const file of ["apps/admin/src/utils/event-dates.ts", "apps/admin/src/api/client.ts"]) {
      expect(scan("export const z = Intl.DateTimeFormat().resolvedOptions().timeZone; const t = viewerLocalTime(iso);", file)).toEqual({
        "viewer-zone-read": {},
        "viewer-local-time": {},
      });
    }
  });
});

describe("time-zone-standard scanner: viewerLocalTime", () => {
  it("counts each call, per file", () => {
    expect(scan("const a = viewerLocalTime(x); const b = viewerLocalTime(y);")["viewer-local-time"]).toEqual(only(2));
    const other = "apps/admin/src/components/Other.tsx";
    expect(scanTimeZones({ [FILE]: "viewerLocalTime(x);", [other]: "viewerLocalTime(x);" })["viewer-local-time"]).toEqual({ [FILE]: 1, [other]: 1 });
  });

  it("does not count a function that only has the name in it", () => {
    expect(scan("const a = viewerLocalTimeText(x);")["viewer-local-time"]).toEqual({});
    expect(scan("const a = obj.viewerLocalTime;")["viewer-local-time"]).toEqual({});
  });
});

describe("time-zone-standard scanner: input", () => {
  it("parses TypeScript and TSX, and says which file it could not read", () => {
    expect(scan("const z: string = getBrowserTimeZone() as string;", "apps/admin/src/utils/zone.ts")["viewer-zone-read"]).toEqual({
      "apps/admin/src/utils/zone.ts": 1,
    });
    expect(() => scan("const = ;")).toThrow(/could not parse apps\/admin\/src\/pages\/Example\.tsx/);
  });
});
