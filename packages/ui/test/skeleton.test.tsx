import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "../src/components/Skeleton.js";

describe("Skeleton", () => {
  it("renders three skeleton lines for variant=text with lines=3", () => {
    const { container } = render(<Skeleton variant="text" lines={3} />);
    const lines = container.querySelectorAll(".at-skeleton");
    expect(lines).toHaveLength(3);
  });

  it("sets last line width to 60%", () => {
    const { container } = render(<Skeleton variant="text" lines={3} />);
    const lines = container.querySelectorAll(".at-skeleton");
    expect((lines[2] as HTMLElement).style.width).toBe("60%");
  });
});
