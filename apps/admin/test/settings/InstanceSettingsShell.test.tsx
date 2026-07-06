// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { render } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({
    assignments: [{ role: "superadmin", scope_type: "instance", scope_id: null }],
  }),
}));

vi.mock("../../src/layouts/StaffShell.js", () => ({
  StaffShell: ({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) => (
    <div>
      <nav data-testid="sidebar">{sidebar}</nav>
      {children}
    </div>
  ),
}));

import { InstanceSettingsShell } from "../../src/layouts/InstanceSettingsShell.js";

afterEach(() => {
  cleanup();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<InstanceSettingsShell />}>
          <Route path="/admin" index element={<div>home</div>} />
          <Route path="/admin/settings" element={<Outlet />}>
            <Route index element={<div>settings</div>} />
            <Route path="identity/cloudflare" element={<div>cf-editor</div>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("InstanceSettingsShell settingsActive", () => {
  it("marks Settings nav-item active on /admin/settings", () => {
    renderAt("/admin/settings");
    const link = screen.getByRole("link", { name: /settings/i });
    expect(link.className).toContain("nav-item--active");
  });

  it("marks Settings nav-item active on /admin/settings/identity/cloudflare", () => {
    renderAt("/admin/settings/identity/cloudflare");
    const link = screen.getByRole("link", { name: /settings/i });
    expect(link.className).toContain("nav-item--active");
  });

  it("does not mark Settings nav-item active on /admin", () => {
    renderAt("/admin");
    const link = screen.getByRole("link", { name: /settings/i });
    expect(link.className).not.toContain("nav-item--active");
  });
});
