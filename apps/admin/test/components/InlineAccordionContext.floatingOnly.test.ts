import { describe, expect, it } from "vitest";
import { floatingOnly } from "../../src/components/InlineAccordionContext.js";

describe("floatingOnly", () => {
  it("passes the value through in floating mode", () => {
    expect(floatingOnly(false, "ref-value")).toBe("ref-value");
  });

  it("discards the value in inline mode", () => {
    expect(floatingOnly(true, "ref-value")).toBeUndefined();
  });
});
