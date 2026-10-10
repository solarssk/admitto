import { Skeleton } from "@admitto/ui";
import { useDelayedLoading, useLoadingGate } from "../hooks/useDelayedLoading.js";
import {
  SettingsPanelSkeleton,
  SettingsSkeletonCardView,
  SettingsSkeletonRegion,
  type SettingsSkeletonCard,
} from "../settings/SettingsPanelSkeleton.js";
import { SLOW_NOTICE_MS } from "../utils/loading-timing.js";
import type { CommunicationTabId } from "./CommunicationHeader.js";
import "./communication.css";

/** The template editor's card (the same as the editor's own, which is why the lazy chunk's fallback draws it too): the
 * ticket template is the one the first read opens, and is titled as such. */
function editorCard(ticket: boolean): SettingsSkeletonCard {
  return { id: "template", title: ticket ? "Ticket template" : "Template", rows: 1, rowHeight: 516 };
}

/** The cards of each tab that is a plain stack of cards, while the page's first read is on its way (their real titles, and a
 * shape and size measured in Chrome). */
const STACKED_TAB_CARDS: Readonly<Record<Exclude<CommunicationTabId, "wallets">, ReadonlyArray<SettingsSkeletonCard>>> = {
  send: [
    { id: "message", title: "Email message", intro: true, fields: 1, rows: 1, rowHeight: 477 },
    { id: "send-to", title: "Send to", intro: true, rows: 5, rowHeight: 91 },
  ],
  templates: [
    // The bar with the template picker and its New and Edit buttons: a card with no title, one row of controls.
    { id: "picker", title: null, rows: 1, rowHeight: 36 },
    editorCard(true),
    { id: "test", title: "Send test", rows: 1, rowHeight: 91 },
  ],
  log: [{ id: "log", title: "Delivery log", rows: 5, rowHeight: 43 }],
};

/** The Wallets tab: the message and its preview side by side (the real tab's grid, which stacks on a narrow screen), the
 * notice about the limits of the wallet services, and the Send to card. */
const WALLET_PAIR: ReadonlyArray<SettingsSkeletonCard> = [
  { id: "message", title: "Message", rows: 1, rowHeight: 312 },
  { id: "preview", title: "Preview", rows: 1, rowHeight: 96 },
];
const WALLET_NOTICE_HEIGHT = 56;
const WALLET_SEND_TO: SettingsSkeletonCard = { id: "send-to", title: "Send to", rows: 1, rowHeight: 351 };

function WalletsSkeleton({ held, slow }: Readonly<{ held: boolean; slow: boolean }>) {
  return (
    <SettingsSkeletonRegion label="Loading communication" held={held} slow={slow}>
      <div className="communication-templates-split">
        {WALLET_PAIR.map((card) => (
          <SettingsSkeletonCardView key={card.id} card={card} />
        ))}
      </div>
      <div aria-hidden="true">
        <Skeleton variant="rect" height={WALLET_NOTICE_HEIGHT} />
      </div>
      <SettingsSkeletonCardView card={WALLET_SEND_TO} />
    </SettingsSkeletonRegion>
  );
}

/** Communication below its header, while the first read of the page is on its way: the open tab's own cards as grey shapes. */
export function CommunicationSkeleton({
  tab,
  held,
  slow,
}: Readonly<{ tab: CommunicationTabId; held: boolean; slow: boolean }>) {
  if (tab === "wallets") return <WalletsSkeleton held={held} slow={slow} />;
  return (
    <SettingsPanelSkeleton label="Loading communication" held={held} slow={slow} cards={STACKED_TAB_CARDS[tab]} footer={false} />
  );
}

/** The template editor's card while its code (a lazily loaded chunk with the code editor) is on its way: the same card, as grey shapes. */
export function TemplateEditorFallback({ ticket = true }: Readonly<{ ticket?: boolean }>) {
  const gate = useLoadingGate(true);
  const slow = useDelayedLoading(true, SLOW_NOTICE_MS);
  return (
    <SettingsPanelSkeleton
      label="Loading editor"
      held={!gate.showIndicator}
      slow={slow}
      cards={[editorCard(ticket)]}
      footer={false}
    />
  );
}
