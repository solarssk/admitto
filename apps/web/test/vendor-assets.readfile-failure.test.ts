import { describe, expect, it, vi } from "vitest";

// Isolated on purpose (like vendor-assets.resolve-failure.test.ts): mocks node:fs so
// readFileSync throws for exactly one already-resolved file, simulating it vanishing between
// require.resolve succeeding and the read itself - real reads pass through unmocked otherwise, so
// this doesn't affect any of the module's other font weights.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: (path: unknown, ...args: unknown[]) => {
      if (typeof path === "string" && path.includes("manrope") && path.endsWith("400.css")) {
        throw new Error("ENOENT: simulated - file vanished after a successful resolve");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- passthrough to the real implementation for every other path
      return (actual.readFileSync as any)(path, ...args);
    },
  };
});

describe("readFontsourceWeightCss when a resolved file's readFileSync fails", () => {
  it("degrades to an empty contribution for that one weight instead of throwing", async () => {
    vi.resetModules();
    const mod = await import("../src/vendor-assets.js");

    // Manrope's 400 weight is simulated as unreadable - its @font-face is missing, but the
    // family's other weights (700, also read during the same module-load computation) still work.
    const css = mod.builtInFontFaceCss("Manrope");
    expect(css).toBeDefined();
    expect(css).toContain("font-weight: 700");
    expect(css).not.toContain("font-weight: 400");

    // Unaffected families still get their full, real @font-face text.
    expect(mod.builtInFontFaceCss("Inter")).toContain("font-weight: 400");
  });
});
