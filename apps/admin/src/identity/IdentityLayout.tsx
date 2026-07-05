import { useCallback } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { PageHeader, Tabs, type TabItem } from "@admitto/ui";

const IDENTITY_TABS: TabItem[] = [
  { id: "providers", label: "Providers" },
  { id: "cloudflare", label: "Cloudflare Access" },
];

/** Resolve the active Identity sub-tab from the current pathname. */
function activeTabFromPath(pathname: string): string {
  if (pathname.endsWith("/cloudflare")) return "cloudflare";
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
      navigate(`/admin/settings/identity/${id}`);
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
      {/* Hidden when used as the route anchor for the sub-tab aria; the routed panel below is the real tabpanel. */}
      <div className="identity-section__body">
        <Outlet />
      </div>
    </div>
  );
}
