// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FailureIcon } from "../../src/components/FailureIcon.js";

describe("FailureIcon", () => {
  it("is the circle-x glyph of a failed load, hidden from assistive tech because the message beside it says what failed", () => {
    const { container } = render(<FailureIcon />);
    const icon = container.firstElementChild;
    expect(icon?.tagName).toBe("I");
    expect(icon?.className).toBe("ti ti-circle-x failure-icon");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.textContent).toBe("");
  });

  it("takes an extra class for a spot that sizes it itself, keeping the shared ones", () => {
    const { container } = render(<FailureIcon className="x-large" />);
    expect(container.firstElementChild?.className).toBe("ti ti-circle-x failure-icon x-large");
  });
});
