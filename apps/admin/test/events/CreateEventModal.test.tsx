// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateEventModal } from "../../src/events/CreateEventModal.js";

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  createEvent: vi.fn(),
}));

afterEach(cleanup);

describe("CreateEventModal", () => {
  it("auto-generates slug from title until slug is manually edited", () => {
    render(<CreateEventModal open onClose={() => {}} onCreated={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Event title/), {
      target: { value: "Autumn Summit 2026" },
    });

    expect((screen.getByLabelText(/URL slug/) as HTMLInputElement).value).toBe("autumn-summit-2026");
  });

  it("keeps submit disabled until date is set", () => {
    render(<CreateEventModal open onClose={() => {}} onCreated={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Event title/), {
      target: { value: "Test Event" },
    });

    expect((screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.change(screen.getByLabelText(/Event date/), {
      target: { value: "2026-09-29" },
    });

    expect((screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
