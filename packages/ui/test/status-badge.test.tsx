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

  it("maps accepted to Sent with ok variant (ADR 0007 accepted_only)", () => {
    expect(resolveStatusMeta("accepted")).toEqual({ variant: "ok", label: "Sent" });
  });

  it("keeps queued as warn Pending", () => {
    expect(resolveStatusMeta("queued")).toEqual({ variant: "warn", label: "Pending" });
  });

  it("maps VALID check-in outcome", () => {
    render(<StatusBadge status="VALID" />);
    expect(screen.getByText("Valid")).toBeTruthy();
  });

  it("falls back for unknown status", () => {
    render(<StatusBadge status="custom_unknown" />);
    expect(screen.getByText("custom_unknown")).toBeTruthy();
  });

  it("does not resolve inherited object properties as statuses", () => {
    expect(resolveStatusMeta("toString")).toEqual({
      variant: "neutral",
      label: "toString",
    });
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
    // "cancelled" is deliberately excluded from this list, even though it's a valid
    // EmailDeliveryStatus value - that raw key already belongs to the unrelated attendee/RSVP
    // domain (error/red, see "covers all attendee statuses" above). Callers must remap an
    // EmailDelivery "cancelled" status to "mail_cancelled" before resolving it (see
    // deliveryStatusBadgeKey, apps/admin/src/communication/delivery-format.ts) - asserted below.
  });

  it("gives EmailDelivery's cancelled status its own neutral tone, distinct from attendee/RSVP cancellation", () => {
    expect(resolveStatusMeta("mail_cancelled")).toEqual({ variant: "neutral", label: "Cancelled" });
    // Same label, deliberately different (non-error) tone from the RSVP-domain "cancelled" -
    // an operator stopping a send is not a delivery failure.
    expect(resolveStatusMeta("mail_cancelled").variant).not.toBe(resolveStatusMeta("cancelled").variant);
  });

  it("gives each registration status its own registration_ key and label", () => {
    expect(resolveStatusMeta("registration_awaiting_email")).toEqual({ variant: "neutral", label: "Awaiting email" });
    expect(resolveStatusMeta("registration_pending")).toEqual({ variant: "warn", label: "Waiting for a decision" });
    expect(resolveStatusMeta("registration_waitlist")).toEqual({ variant: "info", label: "Waiting list" });
    expect(resolveStatusMeta("registration_accepted")).toEqual({ variant: "ok", label: "Accepted" });
    expect(resolveStatusMeta("registration_rejected")).toEqual({ variant: "error", label: "Rejected" });
  });

  it("shows a rejected registration as Rejected, while the plain key stays the failed job's", () => {
    render(<StatusBadge status="registration_rejected" />);

    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.queryByText("Failed")).toBeNull();
    // The other domains that use these words keep their own keys and labels.
    expect(resolveStatusMeta("rejected")).toEqual({ variant: "error", label: "Failed" });
    expect(resolveStatusMeta("accepted").label).toBe("Sent");
    expect(resolveStatusMeta("pending").label).toBe("Pending");
  });
});
