// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WalletMessagePreview } from "../../src/communication/WalletMessagePreview.js";

afterEach(() => {
  cleanup();
});

describe("WalletMessagePreview", () => {
  it("shows a placeholder when the message is empty", () => {
    render(<WalletMessagePreview text="" />);
    expect(screen.getByText("Your message will appear here…")).toBeTruthy();
  });

  it("shows a placeholder when the message is only whitespace", () => {
    render(<WalletMessagePreview text="   " />);
    expect(screen.getByText("Your message will appear here…")).toBeTruthy();
  });

  it("renders the trimmed message text once composed", () => {
    render(<WalletMessagePreview text="  Doors close at 6pm  " />);
    expect(screen.getByText("Doors close at 6pm")).toBeTruthy();
    expect(screen.queryByText("Your message will appear here…")).toBeNull();
  });
});
