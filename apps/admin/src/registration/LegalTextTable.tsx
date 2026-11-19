import { Badge, Button, HintLabel, Switch } from "@admitto/ui";
import type { EventDto } from "../api/types.js";
import { ARCHIVED_ACTION_TOOLTIP, ArchivedGuard, isEventArchived } from "../components/ArchivedGuard.js";
import { MoreActionsMenuItem } from "../components/MoreActionsMenuItem.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { BUSY_REASON, KIND_LABEL, PUBLISH_FIRST_REASON, lockReason, textDescription, type LegalTextRow } from "./legalTexts.js";
import "../components/item-table.css";
import "../requirements/requirements.css";
import "./legal-texts.css";

const ROW_ICON = { privacy_notice: "shield-lock", event_terms: "file-text", consent: "checkbox" } as const;

const ASKED_HINT = "The form asks guests for this consent. Only a published consent can be switched on.";

/** What the row whose request is on its way is doing. */
export type PendingAction = { ref: string; action: "asked" | "publish" | "unpublish" | "delete" };

/** What a row can do. The list behind it holds the requests; a row only asks. */
export interface LegalRowControls {
  event: Pick<EventDto, "archived_at">;
  /** Registration is on: the texts it needs cannot be withdrawn. Null while that is not known. */
  registrationOn: boolean | null;
  pending: PendingAction | null;
  onOpen: (row: LegalTextRow) => void;
  onToggleAsked: (row: LegalTextRow, asked: boolean) => void;
  /** Publishing runs at once; the promise ends when the request has. */
  onPublish: (row: LegalTextRow) => Promise<void>;
  /** Unpublishing and deleting ask first. */
  onUnpublish: (row: LegalTextRow) => void;
  onDelete: (row: LegalTextRow) => void;
}

function openLabel(row: LegalTextRow, archived: boolean): "View" | "Edit" | "Write" {
  if (archived) return "View";
  return row.document === null ? "Write" : "Edit";
}

function TextStatus({ row }: Readonly<{ row: LegalTextRow }>) {
  if (row.document === null) return <Badge variant="neutral">Not written</Badge>;
  return <Badge variant={row.document.published ? "ok" : "warn"}>{row.document.published ? "Published" : "Draft"}</Badge>;
}

/** The Asked switch of a consent: on only for a published consent the form asks for, off with its reason for one that is not published. */
function AskedSwitch({ row, controls }: Readonly<{ row: LegalTextRow; controls: LegalRowControls }>) {
  const { document } = row;
  if (document === null) return null;
  const busy = controls.pending?.ref === row.target.ref && controls.pending.action === "asked";
  // One request at a time: while another row's request runs, this switch says so instead of dropping the change.
  const otherBusy = controls.pending !== null && !busy;
  return (
    <ArchivedGuard
      event={controls.event}
      reasonId={`legal-asked-reason-${row.target.ref}`}
      disabled={!document.published || otherBusy}
      tooltip={document.published ? BUSY_REASON : PUBLISH_FIRST_REASON}
    >
      {(guard) => (
        <Switch
          aria-label={`Asked on the form: ${document.title}`}
          checked={document.required && document.published}
          // Off while its own request is on its way, but still focusable, as the switches of the Fields tab are.
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          onChange={(change) => controls.onToggleAsked(row, change.target.checked)}
          {...guard}
        />
      )}
    </ArchivedGuard>
  );
}

/** The kebab of a written text: the open action (for the screen on which the button has gone), publishing, the page guests read, delete. */
function RowMenu({ row, controls }: Readonly<{ row: LegalTextRow; controls: LegalRowControls }>) {
  const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({ align: "end" });
  const { document } = row;
  if (document === null) return null;
  const archived = isEventArchived(controls.event);
  const locked = lockReason(row, controls.registrationOn);
  // The reason is told twice: as the tooltip, and as the line under the name of the item, because a phone has no hover.
  const archivedReason = archived ? ARCHIVED_ACTION_TOOLTIP : null;
  // While a request runs, every mutation of every row waits, with the reason.
  const busyReason = controls.pending === null ? null : BUSY_REASON;
  const withdrawReason = archivedReason ?? locked ?? busyReason;
  const unpublishing = document.published;
  const publishWhy = unpublishing ? withdrawReason : (archivedReason ?? busyReason);
  return (
    <div className="more-actions-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="at-iconbtn at-iconbtn--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${document.title}`}
        onClick={() => setOpen((current) => !current)}
      >
        <i className="ti ti-dots-vertical" aria-hidden="true" />
      </button>
      {open && (
        <div className="more-actions-menu__panel at-scroll" role="menu" ref={panelRef} style={panelStyle}>
          <MoreActionsMenuItem
            className="legal-menu-narrow-only"
            icon={archived ? "eye" : "pencil"}
            label={openLabel(row, archived)}
            hint="Open the text"
            onClick={() => {
              setOpen(false);
              controls.onOpen(row);
            }}
          />
          <MoreActionsMenuItem
            icon={unpublishing ? "eye-off" : "eye-check"}
            label={unpublishing ? "Unpublish" : "Publish"}
            hint={publishWhy ?? (unpublishing ? "Guests can no longer read it" : "Guests can read it at once")}
            disabled={publishWhy !== null}
            tooltip={publishWhy}
            loading={controls.pending?.ref === row.target.ref && controls.pending.action === "publish"}
            onClick={() => {
              if (unpublishing) {
                setOpen(false);
                controls.onUnpublish(row);
              } else void controls.onPublish(row).finally(() => setOpen(false));
            }}
          />
          {document.published && (
            <MoreActionsMenuItem
              icon="external-link"
              label="View as a guest"
              hint="Opens the page guests read, in a new tab"
              onClick={() => {
                setOpen(false);
                window.open(document.public_path, "_blank", "noopener");
              }}
            />
          )}
          <MoreActionsMenuItem
            icon="trash"
            variant="danger"
            label="Delete"
            hint={withdrawReason ?? (row.target.kind === "consent" ? "Removes the text and its page" : "Back to Not written")}
            disabled={withdrawReason !== null}
            tooltip={withdrawReason}
            onClick={() => {
              setOpen(false);
              controls.onDelete(row);
            }}
          />
        </div>
      )}
    </div>
  );
}

function TextRowView({ row, showAsked, controls }: Readonly<{ row: LegalTextRow; showAsked: boolean; controls: LegalRowControls }>) {
  const { target, document } = row;
  const title = document?.title ?? KIND_LABEL[target.kind];
  const label = openLabel(row, isEventArchived(controls.event));
  return (
    <tr>
      <td>
        <div className="requirements-item-cell">
          <span className="requirements-item-type-icon" aria-hidden="true">
            <i className={`ti ti-${ROW_ICON[target.kind]}`} />
          </span>
          <div className="requirements-item-info">
            <div className="requirements-item-name legal-item-name">{title}</div>
            <div className="requirements-item-desc legal-item-desc">{textDescription(row)}</div>
            <div className="item-table__narrow-only">
              <TextStatus row={row} />
            </div>
          </div>
        </div>
      </td>
      <td className="item-table__wide-only legal-status-col">
        <TextStatus row={row} />
      </td>
      {showAsked && (
        <td className="legal-asked-col">
          <div className="requirements-status-cell">
            <AskedSwitch row={row} controls={controls} />
          </div>
        </td>
      )}
      <td className="requirements-item-actions legal-actions-col">
        <div className="requirements-item-actions__wrap">
          {/* A written text has its Edit in the menu too, for the screen on which the button has gone. */}
          <span className={document === null ? undefined : "legal-open-button"}>
            <Button size="sm" variant="secondary" aria-label={`${label} ${title}`} onClick={() => controls.onOpen(row)}>
              {label}
            </Button>
          </span>
          <RowMenu row={row} controls={controls} />
        </div>
      </td>
    </tr>
  );
}

/** A plain table of texts, the same table as Event items and the Fields tab. The Asked column is the consents' (a switch); the two
 * required texts have none, since the form always asks for them. */
export function LegalTextTable({ rows, showAsked, controls }: Readonly<{ rows: readonly LegalTextRow[]; showAsked: boolean; controls: LegalRowControls }>) {
  return (
    <section className="requirements-section item-table legal-table">
      <div className="attendees-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Text</th>
              <th className="item-table__wide-only legal-status-col">Status</th>
              {showAsked && (
                <th className="legal-asked-col">
                  <HintLabel hint={ASKED_HINT}>Asked</HintLabel>
                </th>
              )}
              <th className="requirements-item-actions legal-actions-col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <TextRowView key={row.target.ref} row={row} showAsked={showAsked} controls={controls} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
