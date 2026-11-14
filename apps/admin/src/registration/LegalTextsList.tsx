import { Badge, Button, Card, Notice } from "@admitto/ui";
import type { LegalDocumentLimitsDto } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { KIND_LABEL, type LegalTextRow } from "./legalTexts.js";
import "./legal-texts.css";

const ROW_ICON = { privacy_notice: "shield-lock", event_terms: "file-text", consent: "checkbox" } as const;

/** The line under a title: what kind of text it is, and what the event does with it. */
function rowMeta(row: LegalTextRow): string {
  const { target, document } = row;
  if (target.kind === "consent") {
    return [KIND_LABEL.consent, `key ${target.key ?? ""}`, document?.required ? "asked on the form" : null].filter(Boolean).join(", ");
  }
  return `${KIND_LABEL[target.kind]}, needed before registration can be turned on`;
}

function TextStatus({ row }: Readonly<{ row: LegalTextRow }>) {
  if (row.document === null) return <Badge variant="neutral">Not written</Badge>;
  return <Badge variant={row.document.published ? "ok" : "warn"}>{row.document.published ? "Published" : "Draft"}</Badge>;
}

function TextRow({ row, onOpen }: Readonly<{ row: LegalTextRow; onOpen: (row: LegalTextRow) => void }>) {
  const { target, document } = row;
  const title = document?.title ?? KIND_LABEL[target.kind];
  return (
    <li className="legal-row">
      <span className="legal-row__icon" aria-hidden="true">
        <i className={`ti ti-${ROW_ICON[target.kind]}`} />
      </span>
      <div className="legal-row__text">
        <div className="legal-row__title">{title}</div>
        <div className="legal-row__meta">{rowMeta(row)}</div>
        {document?.published && (
          <a className="legal-row__link" href={document.public_path} target="_blank" rel="noopener noreferrer">
            Public page <i className="ti ti-external-link" aria-hidden="true" />
            <span className="sr-only"> of {title} (opens in a new tab)</span>
          </a>
        )}
      </div>
      <div className="legal-row__side">
        <TextStatus row={row} />
        <Button size="sm" variant="secondary" aria-label={`${document ? "Edit" : "Write"} ${title}`} onClick={() => onOpen(row)}>
          {document ? "Edit" : "Write"}
        </Button>
      </div>
    </li>
  );
}

export interface LegalTextsListProps {
  event: { archived_at?: string | Date | null };
  rows: readonly LegalTextRow[];
  /** What registration still needs published, by the names the list shows. */
  missingNames: readonly string[];
  limits: LegalDocumentLimitsDto;
  onOpen: (row: LegalTextRow) => void;
  onAddConsent: () => void;
  onCopy: () => void;
}

/** The texts of the event: the privacy notice and the terms first (written or not), then the extra consents. */
export function LegalTextsList({ event, rows, missingNames, limits, onOpen, onAddConsent, onCopy }: Readonly<LegalTextsListProps>) {
  const consents = rows.filter((row) => row.target.kind === "consent").length;
  const consentLimitReached = consents >= limits.consents;
  return (
    <Card
      title="Legal texts"
      className="legal-texts-card"
      actions={
        <div className="legal-card-actions">
          <ArchivedGuard event={event} reasonId="legal-copy-reason">
            {(guard) => (
              <Button variant="secondary" icon={<i className="ti ti-copy" aria-hidden="true" />} onClick={onCopy} {...guard}>
                Copy from another event
              </Button>
            )}
          </ArchivedGuard>
          <ArchivedGuard
            event={event}
            reasonId="legal-add-consent-reason"
            disabled={consentLimitReached}
            tooltip={`This event has reached its limit of ${limits.consents} extra consents.`}
          >
            {(guard) => (
              <Button icon={<i className="ti ti-plus" aria-hidden="true" />} onClick={onAddConsent} {...guard}>
                Add consent
              </Button>
            )}
          </ArchivedGuard>
        </div>
      }
    >
      <div className="legal-card-body">
        <p className="settings-card-intro">
          What guests read before they register: the privacy notice, the event terms and any extra consents they tick. Guests can read a
          text only once it is published.
        </p>
        {missingNames.length > 0 && (
          <Notice variant="info">Registration cannot be turned on until these are published: {missingNames.join(", ")}.</Notice>
        )}
        <ul className="legal-list">
          {rows.map((row) => (
            <TextRow key={row.target.ref} row={row} onOpen={onOpen} />
          ))}
        </ul>
      </div>
    </Card>
  );
}
