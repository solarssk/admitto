// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { render } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({
    assignments: [{ role: "superadmin", scope_type: "instance", scope_id: null }],
  }),
}));

import { AdminGuard } from "../../src/auth/RoleRouter.js";

afterEach(() => {
  cleanup();
});

// Mirrors the /admin catch-all registered in App.tsx (#266 slice 5): any unmatched
// /admin/* (e.g. removed legacy /admin/auth/* URLs) redirects to the events picker.
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AdminGuard />}>
          <Route index element={<div>events-picker</div>} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("/admin catch-all", () => {
  it("redirects a removed legacy /admin/auth/* URL to the events picker", async () => {
    renderAt("/admin/auth/providers");
    await waitFor(() => {
      expect(screen.getByText("events-picker")).toBeTruthy();
    });
  });
});
