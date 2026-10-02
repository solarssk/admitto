import { PageHeader } from "@admitto/ui";
import { ScrollFadeTabs } from "../components/ScrollFadeTabs.js";
import { EVENT_SETTINGS_TABS, SUPERADMIN_ONLY_TABS, type EventSettingsTab } from "./eventSettingsTabs.js";

const EVENT_SETTINGS_SUBTITLE = "Manage event details, images, and access.";

/** The tabs a viewer sees: the superadmin-only ones (Mailing, Wallet, Integrations) only for a superadmin. */
export function visibleEventSettingsTabs(isSuperadmin: boolean) {
  return EVENT_SETTINGS_TABS.filter((t) => isSuperadmin || !SUPERADMIN_ONLY_TABS.has(t.id));
}

/**
 * The header of Event settings: the title, the link to the documentation, and the row of tabs. It is the same whether the
 * page's data has arrived or not, so the title and the tabs are there from the first frame, and the tab that is open
 * stays the one the address says while the first load is still on its way.
 */
export function EventSettingsHeader({
  tab,
  isSuperadmin,
  onTabChange,
}: Readonly<{ tab: EventSettingsTab; isSuperadmin: boolean; onTabChange: (id: string) => void }>) {
  return (
    <>
      <PageHeader
        title="Event settings"
        subtitle={EVENT_SETTINGS_SUBTITLE}
        className="event-settings-pageheader"
        actions={
          <a
            href="https://github.com/solarssk/admitto/wiki"
            target="_blank"
            rel="noopener noreferrer"
            className="at-btn at-btn--secondary"
          >
            <span className="at-btn__icon" aria-hidden="true">
              <i className="ti ti-book" aria-hidden="true" />
            </span>
            <span>Documentation</span>
          </a>
        }
      />
      <ScrollFadeTabs value={tab} onChange={onTabChange} tabs={visibleEventSettingsTabs(isSuperadmin)} />
    </>
  );
}
