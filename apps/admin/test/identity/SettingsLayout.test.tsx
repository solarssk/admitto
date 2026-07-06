// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsLayout } from "../../src/layouts/SettingsLayout.js";

afterEach(() => {
  cleanup();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/settings" element={<SettingsLayout />}>
          <Route index element={<div>settings-index</div>} />
          <Route path="identity/providers" element={<div>providers-panel</div>} />
          <Route path="identity/cloudflare" element={<div>cloudflare-panel</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("SettingsLayout on Identity routes", () => {
  it("shows primary Settings tabs with Identity selected on the overview route", () => {
    renderAt("/admin/settings/identity/providers");
    expect(screen.getByText("providers-panel")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Identity" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("tab", { name: "Providers" })).toBeNull();
  });

  it("shows primary Settings tabs on the Cloudflare detail route without sub-tabs", () => {
    renderAt("/admin/settings/identity/cloudflare");
    expect(screen.getByText("cloudflare-panel")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Identity" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("tab", { name: "Cloudflare Access" })).toBeNull();
  });

  it("shows Mail tab selected on non-identity settings path (covers inPageTabFromSearch branch)", () => {
    renderAt("/admin/settings?tab=mail");
    expect(screen.getByText("settings-index")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Mail" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Identity" }).getAttribute("aria-selected")).toBe("false");
  });
});
