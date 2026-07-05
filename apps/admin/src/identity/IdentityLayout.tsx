import { useCallback } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { PageHeader, Tabs, type TabItem } from "@admitto/ui";
import { IDENTITY_BASE } from "./routes.js";

const IDENTITY_TABS: TabItem[] = [
  { id: "providers", label: "Providers" },
  { id: "cloudflare", label: "Cloudflare Access" },
];

/** Resolve the active Identity sub-tab from the current pathname. Uses `includes`
 * so future sub-routes (e.g. /cloudflare/edit in slice 4) still highlight Cloudflare. */
function activeTabFromPath(pathname: string): string {
  if (pathname.includes("/cloudflare")) return "cloudflare";
  return "providers";
}

/**
 * Identity & SSO sub-section layout. Renders the StaffShell-consistent PageHeader
 * and a local sub-nav (Providers / Cloudflare Access) above the routed panel.
 * Fixes #266: identity settings keep the SPA shell instead of jumping to raw HTML.
 */
export function IdentityLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const handleTabChange = useCallback(
    (id: string) => {
      navigate(`${IDENTITY_BASE}/${id}`);
    },
    [navigate],
  );

  return (
    <div className="settings-page identity-section">
      <PageHeader
        title="Identity & SSO"
        subtitle="OpenID Connect providers, group-to-role mapping, and Cloudflare Zero Trust access."
      />
      <Tabs value={activeTabFromPath(pathname)} onChange={handleTabChange} tabs={IDENTITY_TABS} />
      <div className="identity-section__body">
        <Outlet />
      </div>
    </div>
  );
}
