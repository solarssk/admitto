import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  barThenDotGlyph,
  buildNotificationBadgeSvg,
  dotThenBarGlyph,
  generateNotificationEmailAssets,
  notificationBadgeSpecs,
} from "../src/notification-email-assets.js";

describe("dotThenBarGlyph / barThenDotGlyph", () => {
  it("dotThenBarGlyph renders a circle before the bar (dot above stem, like 'i')", () => {
    const svg = dotThenBarGlyph();
    expect(svg.indexOf("<circle")).toBeLessThan(svg.indexOf("<rect"));
    expect(svg).toContain('fill="#ffffff"');
  });

  it("barThenDotGlyph renders the bar before a circle (stem above dot, like '!')", () => {
    const svg = barThenDotGlyph();
    expect(svg.indexOf("<rect")).toBeLessThan(svg.indexOf("<circle"));
    expect(svg).toContain('fill="#ffffff"');
  });

  it("dotThenBarGlyph's circle sits above barThenDotGlyph's circle - same glyph, opposite order", () => {
    const dotThenBarCy = Number(/cy="([\d.]+)"/.exec(dotThenBarGlyph())?.[1]);
    const barThenDotCy = Number(/cy="([\d.]+)"/.exec(barThenDotGlyph())?.[1]);
    expect(dotThenBarCy).toBeLessThan(barThenDotCy);
  });
});

describe("buildNotificationBadgeSvg", () => {
  it("renders an 88x88 circle filled with the given color, plus the glyph markup verbatim", () => {
    const svg = buildNotificationBadgeSvg("#4299e1", "<circle cx=\"1\" cy=\"1\" r=\"1\" />");
    expect(svg).toContain('width="88" height="88" viewBox="0 0 88 88"');
    expect(svg).toContain('<circle cx="44" cy="44" r="44" fill="#4299e1" />');
    expect(svg).toContain('<circle cx="1" cy="1" r="1" />');
  });
});

describe("notificationBadgeSpecs", () => {
  it("returns the 3 severities with their SEVERITY_COLOR values and the right glyph shape", () => {
    const specs = notificationBadgeSpecs();
    expect(specs.map((s) => s.fileName)).toEqual([
      "notification-badge-info.png",
      "notification-badge-warn.png",
      "notification-badge-error.png",
    ]);
    const byName = Object.fromEntries(specs.map((s) => [s.fileName, s]));
    expect(byName["notification-badge-info.png"]!.color).toBe("#4299e1");
    expect(byName["notification-badge-warn.png"]!.color).toBe("#f59f00");
    expect(byName["notification-badge-error.png"]!.color).toBe("#d63939");
    // info uses the "i" shape (dot before bar); warn/error share the "!" shape (bar before dot).
    expect(byName["notification-badge-info.png"]!.glyph).toBe(dotThenBarGlyph());
    expect(byName["notification-badge-warn.png"]!.glyph).toBe(barThenDotGlyph());
    expect(byName["notification-badge-error.png"]!.glyph).toBe(barThenDotGlyph());
  });
});

describe("generateNotificationEmailAssets", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "admitto-notification-email-assets-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("writes admitto-logo.png at 354x108 and the 3 severity badges at 88x88, all real PNGs", async () => {
    const written = await generateNotificationEmailAssets(outDir);

    expect(written).toEqual([
      join(outDir, "admitto-logo.png"),
      join(outDir, "notification-badge-info.png"),
      join(outDir, "notification-badge-warn.png"),
      join(outDir, "notification-badge-error.png"),
    ]);

    for (const path of written) {
      expect(existsSync(path), path).toBe(true);
    }

    const logoMeta = await sharp(join(outDir, "admitto-logo.png")).metadata();
    expect(logoMeta.format).toBe("png");
    expect(logoMeta.width).toBe(354);
    expect(logoMeta.height).toBe(108);

    const badgeMeta = await sharp(join(outDir, "notification-badge-info.png")).metadata();
    expect(badgeMeta.format).toBe("png");
    expect(badgeMeta.width).toBe(88);
    expect(badgeMeta.height).toBe(88);
  });
});
