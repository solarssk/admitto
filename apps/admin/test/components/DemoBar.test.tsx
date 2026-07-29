// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoBar } from "../../src/components/DemoBar.js";

const addToast = vi.fn();

vi.mock("@admitto/ui", () => ({
  useToast: () => ({ addToast }),
}));

afterEach(() => vi.clearAllMocks());

describe("DemoBar", () => {
  it("keeps the warning toast actionable by separating the status from its next step", () => {
    render(<DemoBar />);

    fireEvent.click(screen.getByRole("button", { name: /Warn toast/ }));

    expect(addToast).toHaveBeenCalledWith("3 tickets pending delivery. Check the mail log.", "warning");
  });
});
