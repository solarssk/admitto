import { Button, Card, EmptyState, Notice } from "@admitto/ui";
import type { LegalDocumentLimitsDto } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { LegalTextTable, type LegalRowControls } from "./LegalTextTable.js";
import type { LegalTextRow } from "./legalTexts.js";
import "./legal-texts.css";

export interface LegalTextsListProps {
  controls: LegalRowControls;
  rows: readonly LegalTextRow[];
  /** What registration still needs published, by the names the list shows. */
  missingNames: readonly string[];
  limits: LegalDocumentLimitsDto;
  onAddConsent: () => void;
  onCopy: () => void;
}

/** The texts of the event, in two cards: the privacy notice and the terms (always on the form), and the extra consents (each one switched on or off). */
export function LegalTextsList({ controls, rows, missingNames, limits, onAddConsent, onCopy }: Readonly<LegalTextsListProps>) {
  const { event } = controls;
  const required = rows.filter((row) => row.target.kind !== "consent");
  const consents = rows.filter((row) => row.target.kind === "consent");
  const consentLimitReached = consents.length >= limits.consents;
  const addButton = (reasonId: string) => (
    <ArchivedGuard event={event} reasonId={reasonId} disabled={consentLimitReached} tooltip={`This event has reached its limit of ${limits.consents} extra consents.`}>
      {(guard) => (
        <Button variant="secondary" size="sm" icon={<i className="ti ti-plus" aria-hidden="true" />} onClick={onAddConsent} {...guard}>
          Add consent
        </Button>
      )}
    </ArchivedGuard>
  );
  return (
    <div className="legal-cards">
      <Card
        title="Required texts"
        className="legal-texts-card"
        actions={
          <ArchivedGuard event={event} reasonId="legal-copy-reason">
            {(guard) => (
              <Button variant="secondary" size="sm" icon={<i className="ti ti-copy" aria-hidden="true" />} onClick={onCopy} {...guard}>
                Copy from another event
              </Button>
            )}
          </ArchivedGuard>
        }
      >
        <div className="legal-card-body">
          <p className="settings-card-intro">Always on the form. Both must be published before registration can be turned on.</p>
          {missingNames.length > 0 && (
            <Notice variant="info">Registration cannot be turned on until these are published: {missingNames.join(", ")}.</Notice>
          )}
          <LegalTextTable rows={required} showAsked={false} controls={controls} />
        </div>
      </Card>
      <Card title="Extra consents" className="legal-texts-card" actions={addButton("legal-add-consent-reason")}>
        <div className="legal-card-body">
          <p className="settings-card-intro">Optional checkboxes the form asks guests to tick.</p>
          {consents.length === 0 ? (
            <EmptyState
              className="legal-empty"
              icon={<i className="ti ti-checkbox" aria-hidden="true" />}
              title="No extra consents yet"
              description="Add one when guests must agree to something beyond the privacy notice and terms, such as photos or a newsletter."
              action={addButton("legal-add-consent-empty-reason")}
            />
          ) : (
            <LegalTextTable rows={consents} showAsked controls={controls} />
          )}
        </div>
      </Card>
    </div>
  );
}
