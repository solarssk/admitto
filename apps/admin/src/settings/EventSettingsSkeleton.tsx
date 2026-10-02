import { CHECKIN_BEHAVIOUR_SKELETON_CARDS } from "./CheckInBehaviourPanel.js";
import { EVENT_MAIL_SKELETON_CARDS } from "./EventMailSettingsCard.js";
import { LOCATION_SKELETON_CARDS } from "./LocationSettingsPanel.js";
import { type EventSettingsTab } from "./eventSettingsTabs.js";
import { SettingsPanelSkeleton, type SettingsSkeletonCard } from "./SettingsPanelSkeleton.js";

interface TabSkeleton {
  readonly cards: ReadonlyArray<SettingsSkeletonCard>;
  /** The tab ends with the Reset and Save footer. */
  readonly footer: boolean;
}

/** One card of rows, for the tabs whose own panels draw their cards once their own data has arrived. */
const rowsCard = (id: string, title: string, rows: number, rowHeight: number, intro = true): ReadonlyArray<SettingsSkeletonCard> => [
  { id, title, intro, rows, rowHeight },
];

/** The shape of each tab while the page's first read of the event is on its way: the tab's own cards (their real titles),
 * so the panel that takes their place does not change the size of the page by much. */
const TAB_SKELETONS: Readonly<Record<EventSettingsTab, TabSkeleton>> = {
  general: {
    cards: [
      { id: "status", title: "Status", rows: 1, rowHeight: 62 },
      { id: "basic", title: "Basic information", intro: true, fields: 4, controlHeight: 64 },
    ],
    footer: true,
  },
  location: { cards: LOCATION_SKELETON_CARDS, footer: true },
  "ticket-types": { cards: rowsCard("ticket-types", "Ticket types", 2, 56), footer: true },
  images: { cards: rowsCard("images", "Images", 2, 120), footer: true },
  "checkin-behaviour": { cards: CHECKIN_BEHAVIOUR_SKELETON_CARDS, footer: true },
  mail: { cards: EVENT_MAIL_SKELETON_CARDS, footer: true },
  wallet: { cards: rowsCard("wallet", "Wallet", 4, 76), footer: true },
  integrations: { cards: rowsCard("integrations", "Integrations", 3, 76), footer: false },
  "danger-zone": { cards: rowsCard("danger-zone", "Danger zone", 5, 72, false), footer: false },
};

/** The page of Event settings, below its header, while the first read of the event is on its way. */
export function EventSettingsSkeleton({ tab, held, slow }: Readonly<{ tab: EventSettingsTab; held: boolean; slow: boolean }>) {
  const { cards, footer } = TAB_SKELETONS[tab];
  return <SettingsPanelSkeleton label="Loading event settings" held={held} slow={slow} cards={cards} footer={footer} />;
}
