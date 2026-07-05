// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { render } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({
    assignments: [{ role: "superadmin", scope_type: "instance", scope_id: null }],
  }),
}));

import { AdminGuard } from "../../src/auth/RoleRouter.js";
import { LegacyProviderRedirect } from "../../src/App.js";

afterEach(() => {
  cleanup();
});

// Mirrors the legacy redirect routes registered in App.tsx under /admin (#266 slice 5).
// The server-rendered /admin/auth/* routes were removed; these SPA-side redirects
// keep old bookmarks/docs links from landing on a blank outlet.
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AdminGuard />}>
          <Route path="auth/providers" element={<Navigate to="/admin/settings/identity/providers" replace />} />
          <Route path="auth/providers/new" element={<Navigate to="/admin/settings/identity/providers/new" replace />} />
          <Route path="auth/providers/:providerId" element={<LegacyProviderRedirect />} />
          <Route path="auth/cf-access" element={<Navigate to="/admin/settings/identity/cloudflare" replace />} />
        </Route>
        <Route path="/admin/settings/identity/providers" element={<div>providers-panel</div>} />
        <Route path="/admin/settings/identity/providers/new" element={<div>new-provider</div>} />
        <Route path="/admin/settings/identity/providers/:providerId" element={<div>edit-provider</div>} />
        <Route path="/admin/settings/identity/cloudflare" element={<div>cloudflare-panel</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Legacy identity URL redirects", () => {
  it("redirects /admin/auth/providers to the SPA providers list", async () => {
    renderAt("/admin/auth/providers");
    await waitFor(() => {
      expect(screen.getByText("providers-panel")).toBeTruthy();
    });
  });

  it("redirects /admin/auth/providers/new to the SPA create route", async () => {
    renderAt("/admin/auth/providers/new");
    await waitFor(() => {
      expect(screen.getByText("new-provider")).toBeTruthy();
    });
  });

  it("redirects /admin/auth/providers/:id to the SPA edit route", async () => {
    renderAt("/admin/auth/providers/abc-123");
    await waitFor(() => {
      expect(screen.getByText("edit-provider")).toBeTruthy();
    });
  });

  it("redirects /admin/auth/cf-access to the SPA Cloudflare editor", async () => {
    renderAt("/admin/auth/cf-access");
    await waitFor(() => {
      expect(screen.getByText("cloudflare-panel")).toBeTruthy();
    });
  });
});
