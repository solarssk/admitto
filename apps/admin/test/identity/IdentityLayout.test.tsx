// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { IdentityLayout } from "../../src/identity/IdentityLayout.js";

afterEach(() => {
  cleanup();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/settings/identity" element={<IdentityLayout />}>
          <Route path="providers" element={<div>providers-panel</div>} />
          <Route path="cloudflare" element={<div>cloudflare-panel</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("IdentityLayout", () => {
  it("highlights Providers and renders its outlet on /identity/providers", () => {
    renderAt("/admin/settings/identity/providers");
    expect(screen.getByText("providers-panel")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Providers" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Cloudflare Access" }).getAttribute("aria-selected")).toBe("false");
  });

  it("highlights Cloudflare Access on /identity/cloudflare", () => {
    renderAt("/admin/settings/identity/cloudflare");
    expect(screen.getByText("cloudflare-panel")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Cloudflare Access" }).getAttribute("aria-selected")).toBe("true");
  });

  it("navigates to the Cloudflare sub-route when that tab is clicked", () => {
    renderAt("/admin/settings/identity/providers");
    fireEvent.click(screen.getByRole("tab", { name: "Cloudflare Access" }));
    expect(screen.getByText("cloudflare-panel")).toBeTruthy();
  });

  it("navigates back to Providers when that tab is clicked from Cloudflare", () => {
    renderAt("/admin/settings/identity/cloudflare");
    fireEvent.click(screen.getByRole("tab", { name: "Providers" }));
    expect(screen.getByText("providers-panel")).toBeTruthy();
  });
});
