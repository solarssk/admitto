import { describe, expect, it } from "vitest";
import { findAdmittoRepoRoot } from "../../src/ops/repo-root.js";

describe("findAdmittoRepoRoot", () => {
  it("returns null when no admitto root exists from startDir", () => {
    expect(findAdmittoRepoRoot("/")).toBeNull();
  });

  it("finds monorepo root from process cwd in tests", () => {
    expect(findAdmittoRepoRoot()).not.toBeNull();
  });
});
