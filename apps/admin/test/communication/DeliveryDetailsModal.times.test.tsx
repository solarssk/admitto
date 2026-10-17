// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeliveryDetailDto, DeliveryDto } from "../../src/api/types.js";
import { DeliveryDetailsModal } from "../../src/communication/DeliveryDetailsModal.js";
import { setPreferredLocale } from "../../src/utils/locale-store.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, fetchEventDelivery: vi.fn() };
});

import { fetchEventDelivery } from "../../src/api/client.js";

const mockDetail = vi.mocked(fetchEventDelivery);

function deliveryIn(clientTimezone: string | null): DeliveryDto {
  return {
    id: "del-1",
    attendee_id: "att-1",
    attendee_name: "Jane Doe",
    purpose: "initial",
    status: "accepted",
    provider: "graph",
    provider_message_id: "msg-1",
    attempts: 1,
    retryable: null,
    recipient_email: "jane@example.com",
    rendered_subject: "Your ticket",
    template_id: null,
    template_name: null,
    queued_at: "2026-06-28T13:00:00.000Z",
    accepted_at: "2026-06-28T13:00:05.000Z",
    sent_at: null,
    failed_at: null,
    error_code: null,
    error: null,
    client_timezone: clientTimezone,
  };
}

async function openWith(clientTimezone: string | null) {
  const row = deliveryIn(clientTimezone);
  const detail: DeliveryDetailDto = { ...row, batch_id: null, actor_user_id: null, actor_display: "Sam Staff", session_id: null, timeline: [row] };
  mockDetail.mockResolvedValue(detail);
  render(
    <MemoryRouter>
      <DeliveryDetailsModal eventId="evt-1" row={row} onClose={vi.fn()} onViewSentMessage={vi.fn()} />
    </MemoryRouter>,
  );
  await screen.findByText("Provider message ID");
}

const valueOf = (label: string) => screen.getByText(label).closest("div")?.querySelector("dd")?.textContent;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setPreferredLocale(null);
});

describe("DeliveryDetailsModal: the times of a delivery", () => {
  it("shows them in the zone of the browser that triggered the send, with its offset", async () => {
    setPreferredLocale("en-GB");
    await openWith("Asia/Kolkata");

    expect(valueOf("Queued at")).toBe("28 Jun 2026, 18:30 UTC+5:30");
    expect(valueOf("Accepted at")).toBe("28 Jun 2026, 18:30 UTC+5:30");
    expect(valueOf("Sent at")).toBe("-");
  });

  it("shows them in UTC when the send stored no zone", async () => {
    setPreferredLocale("en-GB");
    await openWith(null);

    expect(valueOf("Queued at")).toBe("28 Jun 2026, 13:00 UTC");
  });
});
