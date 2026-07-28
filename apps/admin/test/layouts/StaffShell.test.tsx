// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffShell } from "../../src/layouts/StaffShell.js";

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({
    user: { display_name: "Ola Operator", email: "ola@example.com", mailer_status: "ok" },
    assignments: [{ role: "superadmin", scope_type: "instance" as const, scope_id: null }],
  }),
}));

vi.mock("../../src/components/SystemStatus.js", () => ({
  SystemStatus: ({ eventId }: { eventId?: string }) => (
    <span data-testid="system-status" data-event-id={eventId ?? ""} />
  ),
}));

vi.mock("../../src/components/UserMenu.js", () => ({
  UserMenu: () => <span data-testid="user-menu" />,
}));

function renderShell(eventId?: string) {
  return render(
    <MemoryRouter>
      <StaffShell
        sidebar={<span>nav items</span>}
        subnav={<span>section nav</span>}
        eventId={eventId}
        brandTo="/admin"
        brandEnd
      >
        <div>page content</div>
      </StaffShell>
    </MemoryRouter>,
  );
}

function shellRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>(".shell");
  if (!root) throw new Error("shell root not rendered");
  return root;
}

afterEach(() => {
  cleanup();
});

describe("StaffShell", () => {
  it("renders sidebar, subnav, content and the topbar", () => {
    renderShell();
    expect(screen.getByText("nav items")).toBeTruthy();
    expect(screen.getByText("section nav")).toBeTruthy();
    expect(screen.getByText("page content")).toBeTruthy();
    expect(screen.getByTestId("system-status")).toBeTruthy();
    expect(screen.getByTestId("user-menu")).toBeTruthy();
  });

  it("forwards eventId to SystemStatus", () => {
    renderShell("evt-123");
    expect(screen.getByTestId("system-status").dataset.eventId).toBe("evt-123");
  });

  it("renders the topbar brand link using the given brandTo/brandEnd", () => {
    renderShell();
    const brand = screen.getByRole("link", { name: "Admitto" });
    expect(brand.getAttribute("href")).toBe("/admin");
  });

  it("opens the mobile nav from the topbar menu and closes it via the backdrop", () => {
    const { container } = renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(shellRoot(container).className).toContain("shell--nav-open");
    const backdrop = container.querySelector(".shell__backdrop");
    if (!backdrop) throw new Error("backdrop not rendered");
    fireEvent.click(backdrop);
    expect(shellRoot(container).className).not.toContain("shell--nav-open");
  });
});
