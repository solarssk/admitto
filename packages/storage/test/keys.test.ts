import { describe, expect, it } from "vitest";
import {
  extractUploadKeysFromText,
  isManagedUploadKey,
  tryParseUploadKey,
} from "../src/index.js";

describe("tryParseUploadKey", () => {
  it("parses org, theme, and event layouts", () => {
    const org = "default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png";
    expect(tryParseUploadKey(`/uploads/${org}`)).toBe(org);
    expect(tryParseUploadKey(org)).toBe(org);

    const theme = "default/theme/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.woff2";
    expect(tryParseUploadKey(`/uploads/${theme}`)).toBe(theme);

    const event = "default/events/evt-1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg";
    expect(tryParseUploadKey(`/uploads/${event}`)).toBe(event);
  });

  it("rejects external URLs and escapes", () => {
    expect(tryParseUploadKey("https://cdn.example.com/logo.png")).toBeNull();
    expect(tryParseUploadKey("/uploads/../etc/passwd")).toBeNull();
    expect(tryParseUploadKey("/uploads/default/not-a-uuid.png")).toBeNull();
    expect(isManagedUploadKey("default/readme.txt")).toBe(false);
  });
});

describe("extractUploadKeysFromText", () => {
  it("finds managed paths inside HTML template bodies", () => {
    const key = "default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png";
    const html = `<img src="/uploads/${key}" alt="x"> and again /uploads/${key} trailing`;
    expect(extractUploadKeysFromText(html)).toEqual([key, key]);
  });
});
