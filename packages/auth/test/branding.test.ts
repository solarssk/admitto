import { describe, expect, it } from "vitest";
import { sanitizeBrandingThemeForTests as sanitizeTheme } from "../src/settings/branding.js";

describe("sanitizeTheme (branding theme storage validation)", () => {
  it("keeps a valid hex primary", () => {
    expect(sanitizeTheme({ primary: "#123abc" }).primary).toBe("#123abc");
  });

  it("drops an invalid primary", () => {
    expect(sanitizeTheme({ primary: "not-a-color" }).primary).toBeUndefined();
  });

  it("sanitizes ticket_font_family_name the same way as font_family_name, independently", () => {
    const result = sanitizeTheme({
      font_family_name: "Admin Sans",
      ticket_font_family_name: "Ticket Sans",
    });
    expect(result.font_family_name).toBe("Admin Sans");
    expect(result.ticket_font_family_name).toBe("Ticket Sans");
  });

  it("sanitizes an unsafe ticket_font_family_name instead of rejecting the whole theme", () => {
    const result = sanitizeTheme({ ticket_font_family_name: "</style><script>1</script>" });
    expect(result.ticket_font_family_name).toBe("stylescript1script");
  });

  it("leaves ticket_font_family_name undefined when absent, without affecting font_family_name", () => {
    const result = sanitizeTheme({ font_family_name: "Admin Sans" });
    expect(result.font_family_name).toBe("Admin Sans");
    expect(result.ticket_font_family_name).toBeUndefined();
  });

  it("keeps a validated local /uploads/.../theme/ font path", () => {
    const result = sanitizeTheme({
      font_family_name: "Brand Sans",
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/abc123.woff2" }] },
      ],
    });
    expect(result.custom_font_families).toEqual([
      { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/abc123.woff2" }] },
    ]);
    expect(result.font_family_name).toBe("Brand Sans");
  });

  it("keeps a valid external https font URL", () => {
    const result = sanitizeTheme({
      font_family_name: "Brand Sans",
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/fonts/brand.woff2" }] },
      ],
    });
    expect(result.custom_font_families).toEqual([
      { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/fonts/brand.woff2" }] },
    ]);
  });

  it("drops a variant with a plain http font URL, keeping the rest of the family", () => {
    const result = sanitizeTheme({
      font_family_name: "Brand Sans",
      custom_font_families: [
        {
          name: "Brand Sans",
          variants: [
            { weight: 400, style: "normal", url: "http://cdn.example.com/fonts/brand.woff2" },
            { weight: 700, style: "normal", url: "https://cdn.example.com/fonts/brand-bold.woff2" },
          ],
        },
      ],
    });
    expect(result.custom_font_families).toEqual([
      {
        name: "Brand Sans",
        variants: [{ weight: 700, style: "normal", url: "https://cdn.example.com/fonts/brand-bold.woff2" }],
      },
    ]);
  });

  // Each of these leaves the lone variant's URL rejected, so the whole family has zero valid
  // variants left and is dropped entirely - a generated upload filename is always a plain
  // uuid.ext, so the CSS-breaking-characters case only matters for a hand-crafted PUT straight to
  // the API, but this is the server-side boundary, so it has to reject it on its own rather than
  // trusting the admin UI's own upload flow was used.
  it.each([
    ["outside the theme upload namespace", "/uploads/default/events/evt-1/abc123.woff2"],
    ["directory traversal", "/uploads/default/theme/../../etc/passwd.woff2"],
    ["CSS-breaking characters in the filename", '/uploads/default/theme/a".woff2'],
  ])("drops a whole family whose only variant's path is %s", (_label, url) => {
    const result = sanitizeTheme({
      font_family_name: "Brand Sans",
      custom_font_families: [{ name: "Brand Sans", variants: [{ weight: 400, style: "normal", url }] }],
    });
    expect(result.custom_font_families).toBeUndefined();
  });

  it("drops a whole family whose only variant has an out-of-range weight", () => {
    const result = sanitizeTheme({
      font_family_name: "Brand Sans",
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 950, style: "normal", url: "https://cdn.example.com/fonts/brand.woff2" }] },
      ],
    });
    expect(result.custom_font_families).toBeUndefined();
  });

  it("drops a whole family whose only variant has an invalid style", () => {
    const result = sanitizeTheme({
      font_family_name: "Brand Sans",
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 400, style: "oblique", url: "https://cdn.example.com/fonts/brand.woff2" }] },
      ],
    });
    expect(result.custom_font_families).toBeUndefined();
  });

  it("keeps multiple valid variants under one family", () => {
    const result = sanitizeTheme({
      font_family_name: "Brand Sans",
      custom_font_families: [
        {
          name: "Brand Sans",
          variants: [
            { weight: 400, style: "normal", url: "https://cdn.example.com/regular.woff2" },
            { weight: 700, style: "normal", url: "https://cdn.example.com/bold.woff2" },
          ],
        },
      ],
    });
    expect(result.custom_font_families?.[0]?.variants).toHaveLength(2);
  });

  it("keeps multiple distinct saved families", () => {
    const result = sanitizeTheme({
      font_family_name: "First",
      custom_font_families: [
        { name: "First", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/a.woff2" }] },
        { name: "Second", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/b.woff2" }] },
      ],
    });
    expect(result.custom_font_families).toHaveLength(2);
  });

  it("drops a family whose name sanitizes to empty, keeping the others", () => {
    const result = sanitizeTheme({
      custom_font_families: [
        { name: "<<<>>>", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/a.woff2" }] },
        { name: "Good Name", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/b.woff2" }] },
      ],
    });
    expect(result.custom_font_families).toEqual([
      { name: "Good Name", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/b.woff2" }] },
    ]);
  });

  it("skips malformed (non-object) entries in custom_font_families, keeping the valid one", () => {
    const result = sanitizeTheme({
      custom_font_families: [
        null,
        "garbage",
        { name: "Good Name", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/b.woff2" }] },
      ],
    });
    expect(result.custom_font_families).toEqual([
      { name: "Good Name", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/b.woff2" }] },
    ]);
  });

  it("drops a family whose own name field isn't a string", () => {
    const result = sanitizeTheme({
      custom_font_families: [
        { name: 123, variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/a.woff2" }] },
        { name: "Good Name", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/b.woff2" }] },
      ],
    });
    expect(result.custom_font_families).toEqual([
      { name: "Good Name", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/b.woff2" }] },
    ]);
  });

  it("drops a family whose variants field is not an array", () => {
    const result = sanitizeTheme({
      custom_font_families: [
        { name: "Bad Family", variants: "not-an-array" },
        { name: "Good Family", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/z.woff2" }] },
      ],
    });
    expect(result.custom_font_families).toEqual([
      { name: "Good Family", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/z.woff2" }] },
    ]);
  });

  it("skips malformed (non-object) entries within a family's variants array, keeping the valid ones", () => {
    const result = sanitizeTheme({
      custom_font_families: [
        {
          name: "Brand Sans",
          variants: [null, "garbage", { weight: 400, style: "normal", url: "https://cdn.example.com/ok.woff2" }],
        },
      ],
    });
    expect(result.custom_font_families?.[0]?.variants).toEqual([
      { weight: 400, style: "normal", url: "https://cdn.example.com/ok.woff2" },
    ]);
  });

  it("rejects a variant URL carrying only a password (empty username) as credentialed", () => {
    const result = sanitizeTheme({
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "https://:secret@example.com/font.woff2" }] },
      ],
    });
    expect(result.custom_font_families).toBeUndefined();
  });

  it("dedupes families by (sanitized) name, keeping only the first occurrence", () => {
    const result = sanitizeTheme({
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/first.woff2" }] },
        { name: "Brand Sans", variants: [{ weight: 700, style: "normal", url: "https://cdn.example.com/second.woff2" }] },
      ],
    });
    expect(result.custom_font_families).toEqual([
      { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/first.woff2" }] },
    ]);
  });

  it("caps the number of variants persisted per family at the admin UI's own 9-weight x 2-style limit", () => {
    const variants = Array.from({ length: 20 }, (_, i) => ({
      weight: 400,
      style: i % 2 === 0 ? ("normal" as const) : ("italic" as const),
      url: `https://cdn.example.com/font-${i}.woff2`,
    }));
    const result = sanitizeTheme({
      font_family_name: "Brand Sans",
      custom_font_families: [{ name: "Brand Sans", variants }],
    });
    expect(result.custom_font_families?.[0]?.variants.length).toBe(18);
  });

  it.each(["Manrope", "space grotesk", "IBM PLEX SANS"])(
    "drops a custom family named after a built-in font (%s), case-insensitively",
    (name) => {
      const result = sanitizeTheme({
        custom_font_families: [
          { name, variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/a.woff2" }] },
          { name: "Good Name", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/b.woff2" }] },
        ],
      });
      expect(result.custom_font_families).toEqual([
        { name: "Good Name", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/b.woff2" }] },
      ]);
    },
  );

  it("caps the number of saved families", () => {
    const families = Array.from({ length: 15 }, (_, i) => ({
      name: `Family ${i}`,
      variants: [{ weight: 400, style: "normal" as const, url: `https://cdn.example.com/font-${i}.woff2` }],
    }));
    const result = sanitizeTheme({ custom_font_families: families });
    expect(result.custom_font_families?.length).toBeLessThanOrEqual(8);
  });

  it("ignores a non-array custom_font_families value", () => {
    const result = sanitizeTheme({ font_family_name: "Brand Sans", custom_font_families: "not-an-array" });
    expect(result.custom_font_families).toBeUndefined();
    expect(result.font_family_name).toBe("Brand Sans");
  });

  it("sanitizes an unsafe font family name instead of rejecting the whole theme", () => {
    const result = sanitizeTheme({ font_family_name: "</style><script>1</script>" });
    expect(result.font_family_name).toBe("stylescript1script");
  });

  it("truncates a long font name to 128 characters", () => {
    const result = sanitizeTheme({ font_family_name: "X".repeat(200) });
    expect(result.font_family_name?.length).toBe(128);
  });

  it("drops a whole family whose only variant's URL is longer than 2048 characters", () => {
    const longUrl = `https://fonts.example/${"a".repeat(2100)}.woff2`;
    const result = sanitizeTheme({
      font_family_name: "Brand Sans",
      custom_font_families: [{ name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: longUrl }] }],
    });
    expect(result.custom_font_families).toBeUndefined();
  });

  it("returns an empty object for non-object input", () => {
    expect(sanitizeTheme(null)).toEqual({});
    expect(sanitizeTheme(undefined)).toEqual({});
    expect(sanitizeTheme("garbage")).toEqual({});
  });

  describe("legacy font_family_url migration", () => {
    it("converts a pre-existing single-file record into a one-variant custom_font_families entry", () => {
      const result = sanitizeTheme({
        primary: "#123456",
        font_family_name: "Old Font",
        font_family_url: "/uploads/default/theme/old.woff2",
      });
      expect(result.font_family_name).toBe("Old Font");
      expect(result.custom_font_families).toEqual([
        { name: "Old Font", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/old.woff2" }] },
      ]);
    });

    it("does not migrate when custom_font_families is already present, even alongside a stale font_family_url", () => {
      const result = sanitizeTheme({
        font_family_name: "New Font",
        font_family_url: "/uploads/default/theme/stale.woff2",
        custom_font_families: [
          { name: "New Font", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/new.woff2" }] },
        ],
      });
      expect(result.custom_font_families).toEqual([
        { name: "New Font", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/new.woff2" }] },
      ]);
    });

    it("drops an unsafe legacy font_family_url instead of migrating it", () => {
      const result = sanitizeTheme({ font_family_name: "Old Font", font_family_url: "http://insecure.example/x.woff2" });
      expect(result.custom_font_families).toBeUndefined();
    });

    it("does nothing when there's no font_family_name to build a family under", () => {
      const result = sanitizeTheme({ font_family_url: "/uploads/default/theme/old.woff2" });
      expect(result.custom_font_families).toBeUndefined();
    });
  });
});
