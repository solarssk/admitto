// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MailStatusBadge } from "../../src/attendees/mailStatusBadge.js";

afterEach(cleanup);

describe("MailStatusBadge", () => {
  it("shows accepted as Sent (single source of truth with the delivery log)", () => {
    render(<MailStatusBadge status="accepted" />);
    expect(screen.getByText("Sent")).toBeTruthy();
  });

  it("keeps queued as Pending", () => {
    render(<MailStatusBadge status="queued" />);
    expect(screen.getByText("Pending")).toBeTruthy();
  });

  it("shows Not sent when no mail was sent", () => {
    render(<MailStatusBadge status={null} />);
    expect(screen.getByText("Not sent")).toBeTruthy();
  });

  it("falls back to the raw status for unknown values", () => {
    render(<MailStatusBadge status="custom_state" />);
    expect(screen.getByText("custom_state")).toBeTruthy();
  });
});
