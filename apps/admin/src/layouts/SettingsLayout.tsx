import { useCallback, useEffect } from "react";
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@admitto/ui";
import { IDENTITY_PROVIDERS_ROUTE } from "../identity/routes.js";
import { ScrollFadeTabs } from "../components/ScrollFadeTabs.js";
import {
  SETTINGS_INDEX_PATH,
  SETTINGS_TABS,
  inPageTabFromSearch,
  isIdentitySettingsPath,
  isSettingsTab,
  type SettingsTab,
} from "../settings/settingsTabs.js";

/**
 * Instance Settings shell: PageHeader + primary tabs always visible. In-page
 * panels (General/Mail/Security/Archiving) render on the index route; Identity
 * overview and detail views render in the nested `<Outlet />` without a second
 * tab row (#266 slice 7b).
 */
export function SettingsLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const onIdentity = isIdentitySettingsPath(pathname);
  const activeTab: SettingsTab = onIdentity ? "identity" : inPageTabFromSearch(searchParams);

  // Legacy entry: /admin/settings?tab=identity → canonical Identity overview.
  useEffect(() => {
    if (!onIdentity && searchParams.get("tab") === "identity") {
      navigate(IDENTITY_PROVIDERS_ROUTE, { replace: true });
    }
  }, [searchParams, navigate, onIdentity]);

  const handleTabChange = useCallback(
    (id: string) => {
      if (!isSettingsTab(id)) return;
      if (id === "identity") {
        navigate(IDENTITY_PROVIDERS_ROUTE);
        return;
      }
      // Always replace so tab clicks don't accumulate history entries. Leaving an
      // Identity detail view triggers the editor's `useBlocker` when dirty.
      navigate(`${SETTINGS_INDEX_PATH}?tab=${id}`, { replace: true });
    },
    [navigate],
  );

  return (
    <div className="settings-page">
      <PageHeader
        title="Settings"
        subtitle="Instance configuration, security policies, and identity providers."
      />
      <ScrollFadeTabs value={activeTab} onChange={handleTabChange} tabs={[...SETTINGS_TABS]} />
      <Outlet />
    </div>
  );
}
