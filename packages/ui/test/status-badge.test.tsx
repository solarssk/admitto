import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../src/components/StatusBadge.js";
import { resolveStatusMeta, STATUS_MAP } from "../src/status-map.js";

describe("StatusBadge", () => {
  it("maps queued to Pending", () => {
    render(<StatusBadge status="queued" />);
    expect(screen.getByText("Pending")).toBeTruthy();
  });

  it("maps delivered to Sent", () => {
    render(<StatusBadge status="delivered" />);
    expect(screen.getByText("Sent")).toBeTruthy();
  });

  it("maps VALID check-in outcome", () => {
    render(<StatusBadge status="VALID" />);
    expect(screen.getByText("Valid")).toBeTruthy();
  });

  it("falls back for unknown status", () => {
    render(<StatusBadge status="custom_unknown" />);
    expect(screen.getByText("custom_unknown")).toBeTruthy();
  });
});

describe("STATUS_MAP", () => {
  it("covers all attendee statuses", () => {
    expect(resolveStatusMeta("registered").label).toBe("Registered");
    expect(resolveStatusMeta("confirmed").variant).toBe("confirmed");
    expect(resolveStatusMeta("cancelled").variant).toBe("error");
  });

  it("has entries for email delivery DB enums", () => {
    for (const key of ["queued", "accepted", "sent", "delivered", "failed", "rejected", "bounced"]) {
      expect(STATUS_MAP[key]).toBeDefined();
    }
  });
});
