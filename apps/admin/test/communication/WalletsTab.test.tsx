// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletsTab } from "../../src/communication/WalletsTab.js";
import { WALLET_MESSAGE_TEXT_MAX_LENGTH } from "../../src/communication/walletMessageLimits.js";

vi.mock("../../src/communication/WalletMessagePreview.js", () => ({
  WalletMessagePreview: ({ text }: { text: string }) => <div data-testid="preview">{text}</div>,
}));
vi.mock("../../src/communication/WalletsSendPanel.js", () => ({
  WalletsSendPanel: ({ text }: { text: string }) => <div data-testid="send-panel">{text}</div>,
}));

const activeEvent = { archived_at: null };

afterEach(() => {
  cleanup();
});

describe("WalletsTab", () => {
  it("shows the remaining character budget and forwards the composed text to the preview and send panel", () => {
    render(<WalletsTab event={activeEvent} eventId="evt-1" />);

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Doors close soon" } });

    expect(screen.getByText(`${WALLET_MESSAGE_TEXT_MAX_LENGTH - "Doors close soon".length} characters remaining`)).toBeTruthy();
    expect(screen.getByTestId("preview").textContent).toBe("Doors close soon");
    expect(screen.getByTestId("send-panel").textContent).toBe("Doors close soon");
  });

  it("clears the draft message when switching events, so it never carries over to a different event", () => {
    const { rerender } = render(<WalletsTab event={activeEvent} eventId="evt-1" />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Event A message" } });
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Event A message");

    rerender(<WalletsTab event={activeEvent} eventId="evt-2" />);

    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("");
  });

  it("disables the message field for an archived event (via its wrapping fieldset)", () => {
    render(<WalletsTab event={{ archived_at: "2026-01-01T00:00:00.000Z" }} eventId="evt-1" />);

    // fieldset[disabled] disables descendant controls per HTML semantics (:disabled matches),
    // but doesn't set the textarea's own `disabled` IDL attribute - matches() is the correct check.
    expect(screen.getByLabelText("Message").matches(":disabled")).toBe(true);
  });
});
