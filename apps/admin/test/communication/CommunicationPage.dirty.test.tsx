import { describe, expect, it } from "vitest";
import { isTemplateDirty } from "../../src/communication/templateDirty.js";

const saved = {
  subject: "Hello",
  body: "<mjml></mjml>",
  format: "mjml" as const,
};

describe("isTemplateDirty", () => {
  it("is false when draft matches saved snapshot", () => {
    expect(isTemplateDirty(saved, saved)).toBe(false);
  });

  it("is true when subject changes", () => {
    expect(isTemplateDirty({ ...saved, subject: "Updated" }, saved)).toBe(true);
  });

  it("is false again after snapshot matches draft", () => {
    const updated = { ...saved, subject: "Updated" };
    expect(isTemplateDirty(updated, updated)).toBe(false);
  });
});
