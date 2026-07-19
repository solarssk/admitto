// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffShell } from "../../src/layouts/StaffShell.js";

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({
    user: { display_name: "Ola Operator", email: "ola@example.com", mailer_status: "ok" },
    assignments: [{ role: "superadmin", scope_type: "instance" as const, scope_id: null }],
  }),
}));

vi.mock("../../src/components/MailerStatusBadge.js", () => ({
  MailerStatusBadge: () => <span data-testid="mailer-badge" />,
}));

vi.mock("../../src/components/RoleBadge.js", () => ({
  RoleBadge: () => <span data-testid="role-badge" />,
}));

vi.mock("../../src/checkin/ConnectionBanner.js", () => ({
  ServerConnectionBadge: () => <span data-testid="connection-badge" />,
}));

const SIDEBAR_PIN_KEY = "admitto_sidebar_pinned";

function renderShell() {
  return render(
    <StaffShell sidebar={<span>nav items</span>} subnav={<span>section nav</span>}>
      <div>page content</div>
    </StaffShell>,
  );
}

function shellRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>(".shell");
  if (!root) throw new Error("shell root not rendered");
  return root;
}

afterEach(() => {
  cleanup();
  // The pin preference persists in jsdom's localStorage for the lifetime of
  // this worker — clear it so each test starts from the "no preference" state.
  try {
    localStorage.removeItem(SIDEBAR_PIN_KEY);
  } catch {
    /* storage may be unavailable in some Node/jsdom combinations */
  }
});

describe("StaffShell", () => {
  it("renders sidebar, subnav, content and the user name", () => {
    renderShell();
    expect(screen.getByText("nav items")).toBeTruthy();
    expect(screen.getByText("section nav")).toBeTruthy();
    expect(screen.getByText("page content")).toBeTruthy();
    expect(screen.getByText("Ola Operator")).toBeTruthy();
  });

  it("defaults to a pinned sidebar when no preference is stored", () => {
    const { container } = renderShell();
    expect(shellRoot(container).className).not.toContain("shell--sidebar-unpinned");
    expect(screen.getByRole("button", { name: "Unpin sidebar" })).toBeTruthy();
  });

  it("unpins on toggle and persists the preference", () => {
    const { container } = renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Unpin sidebar" }));
    expect(shellRoot(container).className).toContain("shell--sidebar-unpinned");
    expect(screen.getByRole("button", { name: "Pin sidebar" })).toBeTruthy();
    expect(localStorage.getItem(SIDEBAR_PIN_KEY)).toBe("false");
  });

  it("starts unpinned when the stored preference says so, and re-pinning persists", () => {
    localStorage.setItem(SIDEBAR_PIN_KEY, "false");
    const { container } = renderShell();
    expect(shellRoot(container).className).toContain("shell--sidebar-unpinned");
    fireEvent.click(screen.getByRole("button", { name: "Pin sidebar" }));
    expect(shellRoot(container).className).not.toContain("shell--sidebar-unpinned");
    expect(localStorage.getItem(SIDEBAR_PIN_KEY)).toBe("true");
  });

  it("expands an unpinned sidebar on hover and collapses on leave", () => {
    localStorage.setItem(SIDEBAR_PIN_KEY, "false");
    const { container } = renderShell();
    const sidebar = container.querySelector(".sidebar");
    if (!sidebar) throw new Error("sidebar not rendered");
    expect(shellRoot(container).className).not.toContain("shell--sidebar-expanded");
    fireEvent.mouseEnter(sidebar);
    expect(shellRoot(container).className).toContain("shell--sidebar-expanded");
    fireEvent.mouseLeave(sidebar);
    expect(shellRoot(container).className).not.toContain("shell--sidebar-expanded");
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
