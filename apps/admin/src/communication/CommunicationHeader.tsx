import { PageHeader, Tabs } from "@admitto/ui";

export const COMMUNICATION_TAB_IDS = ["send", "wallets", "templates", "log"] as const;
export type CommunicationTabId = (typeof COMMUNICATION_TAB_IDS)[number];

/**
 * The header of Communication: the title, the link to the documentation and the row of tabs. It is the same whether the
 * page's data has arrived or not, so the title and the tabs are there from the first frame; the counts on the Templates and
 * Delivery log tabs (and the unsaved mark) come with the data, and are left out until then.
 */
export function CommunicationHeader({
  tab,
  onTabChange,
  templatesLabel = "Templates",
  templatesCount,
  deliveryTotal,
}: Readonly<{
  tab: string;
  onTabChange: (tab: string) => void;
  templatesLabel?: string;
  templatesCount?: number;
  deliveryTotal?: number;
}>) {
  return (
    <>
      <PageHeader
        className="communication-pageheader"
        title="Communication"
        subtitle="Ticket email templates and delivery log"
        actions={
          <a
            href="https://github.com/solarssk/admitto/wiki/Email-Templates"
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

      <Tabs
        value={tab}
        onChange={onTabChange}
        tabs={[
          { id: "send", label: "Email" },
          { id: "wallets", label: "Wallets" },
          { id: "templates", label: templatesLabel, count: templatesCount },
          { id: "log", label: "Delivery log", count: deliveryTotal || undefined },
        ]}
      />
    </>
  );
}
