import { describe, expect, it } from "vitest";
import { checkFixHint } from "../../src/pages/wizard/checkFixHints.js";

describe("checkFixHint", () => {
  it("does not claim migrations run on app container start (they run in the separate migrate service)", () => {
    const hint = checkFixHint("database");
    expect(hint).not.toMatch(/migrations run automatically on app container start/);
    expect(hint).toMatch(/migrate service/);
  });

  it("does not offer Settings as an equal alternative to BASE_URL, or claim boot enforcement", () => {
    const hint = checkFixHint("base_url");
    expect(hint).not.toMatch(/Set the Instance URL in Settings.*or set BASE_URL/);
    expect(hint).not.toMatch(/required at boot/);
    expect(hint).toMatch(/BASE_URL/);
    // Accurate framing: this is what the check wants, not what the app enforces to run.
    expect(hint).toMatch(/this check/);
  });
});
