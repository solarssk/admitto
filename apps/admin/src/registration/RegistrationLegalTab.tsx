import { useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router";
import { useToast } from "@admitto/ui";
import { ApiError, fetchLegalDocuments } from "../api/client.js";
import type { EventDto } from "../api/types.js";
import { RefetchRegion } from "../components/RefetchRegion.js";
import { RefreshWarning } from "../components/RefreshWarning.js";
import { RetryEmptyState } from "../components/RetryEmptyState.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useCardLoad } from "../hooks/useCardLoad.js";
import { useListLoad } from "../hooks/useListLoad.js";
import { orLoginRedirect } from "../identity/loginRedirect.js";
import { SettingsPanelSkeleton } from "../settings/SettingsPanelSkeleton.js";
import { assertPresent } from "../utils/assert-present.js";
import { pluralSuffix } from "../utils/pluralize.js";
import { CopyLegalTextsDialog } from "./CopyLegalTextsDialog.js";
import { LegalTextEditor } from "./LegalTextEditor.js";
import { LegalTextsList } from "./LegalTextsList.js";
import { legalTextRows, missingTextName, type LegalTextRow, type LegalTextTarget } from "./legalTexts.js";

/** The text open in the editor: one the event has, one it has not written yet, or a consent that is about to be added. */
type OpenText = { target: LegalTextTarget; exists: boolean; newConsent: boolean };

const NEW_CONSENT: OpenText = { target: { ref: "", kind: "consent", key: null }, exists: false, newConsent: true };

/** One event, one tab: a different `:eventId` is a fresh tab (its own read and editor), never the previous one's. */
export function RegistrationLegalTab() {
  const { eventId } = useParams();
  if (!eventId) return <p>Missing event.</p>;
  return <RegistrationLegalBody key={eventId} eventId={eventId} />;
}

/**
 * The legal texts of the event: a list of what guests read (the privacy notice, the terms, the extra consents), and the
 * editor of the text that is opened from it. It follows the loading standard of a card with a list (`useListLoad` and
 * `useCardLoad`): a placeholder in the card's own shape for the first read, an error with a busy Retry that stays on screen
 * until the answer is in, and the list kept, blocked and dimmed, while the read that follows a change runs.
 */
function RegistrationLegalBody({ eventId }: Readonly<{ eventId: string }>) {
  const { event } = useOutletContext<{ event: EventDto }>();
  const { reportApiError } = useConnectionState();
  const { addToast } = useToast();
  const [open, setOpen] = useState<OpenText | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  // A failure is told to the connection state when the answer is in, never when a Retry starts, so the wording of the error on
  // screen does not change while a Retry runs; a 401 hands the browser to the login page instead, and no error flashes up first.
  const fetchList = useMemo(
    () =>
      orLoginRedirect(async (signal: AbortSignal) => {
        try {
          return await fetchLegalDocuments(eventId, signal);
        } catch (err) {
          if (err instanceof ApiError) reportApiError(err.status);
          throw err;
        }
      }),
    [eventId, reportApiError],
  );
  const list = useListLoad({ fetcher: fetchList, fallback: "Could not load the legal texts." });
  const card = useCardLoad(list);

  if (!card.gate.showContent) {
    return (
      <SettingsPanelSkeleton
        label="Loading legal texts"
        held={!card.gate.showIndicator}
        slow={card.slow}
        cards={[{ id: "legal", title: "Legal texts", intro: 2, rows: 3, rowHeight: 60 }]}
        footer={false}
      />
    );
  }
  if (card.failure.error) {
    return (
      <RetryEmptyState
        title="Could not load the legal texts"
        message={card.failure.error}
        retrying={card.failure.retrying}
        onRetry={card.failure.retry}
      />
    );
  }
  assertPresent(list.data);
  const { items, missing, limits } = list.data;

  if (open) {
    return (
      <div className="at-fade-in">
        <LegalTextEditor
          // A text is its own editor: another one never starts from the previous one's words.
          key={open.target.ref}
          eventId={eventId}
          event={event}
          target={open.target}
          exists={open.exists}
          newConsent={open.newConsent}
          usedKeys={new Set(items.flatMap((item) => (item.key === null ? [] : [item.key])))}
          limits={limits}
          onBack={() => setOpen(null)}
          onChanged={() => void list.reload()}
          onDeleted={() => {
            setOpen(null);
            void list.reload();
          }}
        />
      </div>
    );
  }

  function openRow(row: LegalTextRow) {
    setOpen({ target: row.target, exists: row.document !== null, newConsent: false });
  }

  return (
    // What replaces the placeholder fades in.
    <div className="at-fade-in">
      {list.refreshError && <RefreshWarning message={list.refreshError} onRetry={list.reload} />}
      <RefetchRegion refreshing={list.refreshing} label="Refreshing legal texts">
        <LegalTextsList
          event={event}
          rows={legalTextRows(items)}
          missingNames={missing.map((entry) => missingTextName(entry, items))}
          limits={limits}
          onOpen={openRow}
          onAddConsent={() => setOpen(NEW_CONSENT)}
          onCopy={() => setCopyOpen(true)}
        />
      </RefetchRegion>
      <CopyLegalTextsDialog
        open={copyOpen}
        eventId={eventId}
        current={items}
        limits={limits}
        onClose={() => setCopyOpen(false)}
        onCopied={(count, sourceTitle) => {
          setCopyOpen(false);
          addToast(`Copied ${count} legal text${pluralSuffix(count)} from ${sourceTitle}.`, "success");
          void list.reload();
        }}
        onPartial={() => void list.reload()}
      />
    </div>
  );
}
