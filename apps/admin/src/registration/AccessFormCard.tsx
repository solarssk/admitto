import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { Card, Switch } from "@admitto/ui";
import type { LegalDocumentDto } from "../api/types.js";
import { SectionLabel } from "../attendees/SectionLabel.js";
import { MultiSelect } from "../components/MultiSelect.js";
import { consentOptions, type AccessDraft } from "./accessSettings.js";
import { registrationTabPath } from "./registrationTabs.js";
import "./registration-access.css";

type ToggleKey = "waitlist_enabled" | "verify_email" | "ask_company" | "ask_department" | "companion" | "styled_form_controls";

const TOGGLES: Readonly<Record<ToggleKey, { title: string; text: string }>> = {
  waitlist_enabled: { title: "Waiting list", text: "When the event is full, new requests wait for a free place." },
  verify_email: { title: "Confirm email addresses", text: "Guests confirm by a link. It works for 24 hours." },
  ask_company: { title: "Ask for the company", text: "Adds a company question to the form." },
  ask_department: { title: "Ask for the department", text: "Adds a department question to the form." },
  companion: { title: "Guests can bring one person", text: "That person takes a place too." },
  styled_form_controls: {
    title: "Styled form boxes",
    text: "Own calendar, time list and phone country list. A phone question for digits only keeps the browser's box.",
  },
};

/** What the confirmation switch says under the company SSO: the address comes from the identity provider, so no link is sent. */
const VERIFY_EMAIL_PROVIDER_TEXT = "Not used with Company SSO. The identity provider confirms the address.";

/** Whether the provider's sign-in makes this switch meaningless (the server skips the link for the company SSO). */
function providerDecides(key: ToggleKey, draft: AccessDraft): boolean {
  return key === "verify_email" && draft.method === "sso";
}

const APPROVAL_TITLE = "Approve requests by hand";
const APPROVAL_TEXT = "You accept or reject each request on the Requests tab.";
const APPROVAL_OFF_TEXT = "You can choose this once registration is on.";

type FormChange = Partial<Pick<AccessDraft, ToggleKey | "consent_keys" | "mode">>;

/** One labelled group of a card. Each group is its own list of rows, so the first and the last row of a group are spaced as such. */
function Group({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="access-form-group">
      <SectionLabel>{label}</SectionLabel>
      <div className="access-form-group__rows">{children}</div>
    </div>
  );
}

function ToggleRow({ name, draft, disabled, onChange }: Readonly<{ name: ToggleKey; draft: AccessDraft; disabled: boolean; onChange: (change: FormChange) => void }>) {
  const { title, text } = TOGGLES[name];
  const byProvider = providerDecides(name, draft);
  return (
    <div className="settings-row settings-row--switch">
      <div className="settings-row__text">
        <strong>{title}</strong>
        <p>{byProvider ? VERIFY_EMAIL_PROVIDER_TEXT : text}</p>
      </div>
      <Switch checked={draft[name]} disabled={disabled || byProvider} aria-label={title} onChange={(event) => onChange({ [name]: event.target.checked })} />
    </div>
  );
}

/** The mode of registration while it is on: with approval, or automatic. It is a switch of the form, since the Registration page only turns registration on or off. */
function ApprovalRow({ draft, disabled, onChange }: Readonly<{ draft: AccessDraft; disabled: boolean; onChange: (change: FormChange) => void }>) {
  const registrationOn = draft.mode !== null;
  return (
    <div className="settings-row settings-row--switch">
      <div className="settings-row__text">
        <strong>{APPROVAL_TITLE}</strong>
        <p>{registrationOn ? APPROVAL_TEXT : APPROVAL_OFF_TEXT}</p>
      </div>
      <Switch
        checked={draft.mode === "approval"}
        disabled={disabled || !registrationOn}
        aria-label={APPROVAL_TITLE}
        onChange={(event) => onChange({ mode: event.target.checked ? "approval" : "automatic" })}
      />
    </div>
  );
}

/** A settings row whose action is to go somewhere else: the title, one line, and a secondary small button at the right (the look of the rows of the Checklist tab). */
function GoToRow({ title, text, label, to }: Readonly<{ title: string; text: string; label: string; to: string }>) {
  return (
    <div className="settings-row settings-row--switch">
      <div className="settings-row__text">
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
      <div className="settings-row__controls">
        <Link className="at-btn at-btn--secondary at-btn--sm" to={to} aria-label={`${label}: ${title}`}>
          {label}
        </Link>
      </div>
    </div>
  );
}

const CONSENTS_HINT = "Optional checkboxes on the form, for example a marketing consent. The privacy notice and the terms are always shown.";
const CONSENTS_NONE_HINT = "Write a consent on the Legal tab, then choose it here.";

/**
 * The extra consents a guest must accept, chosen from the texts the event has published (the Legal tab writes them). One that is chosen and
 * not published stays in the list, marked, so that it can be taken off. The field is half a row, as a short control is. While there is
 * nothing to choose it is off, says how to get something to choose, and has the way to the Legal tab beside it (the row of Send test email).
 */
function ConsentsField({ eventId, draft, legalItems, disabled, onChange }: Readonly<{ eventId: string; draft: AccessDraft; legalItems: readonly LegalDocumentDto[]; disabled: boolean; onChange: (change: FormChange) => void }>) {
  const options = consentOptions(legalItems, draft.consent_keys);
  const none = options.length === 0;
  const hintId = useId();
  return (
    <div className="access-consents-row">
      <div className="mail-test-send__row">
        <div className="mail-test-send__controls">
          <MultiSelect
            id="access-consents"
            label="Extra consents"
            placeholder={none ? "Nothing to choose yet" : "None"}
            searchPlaceholder="Search consents"
            emptyLabel="No consents found"
            value={draft.consent_keys}
            options={options}
            disabled={disabled || none}
            describedBy={hintId}
            onChange={(ids) => onChange({ consent_keys: ids })}
          />
          {none && (
            <div className="mail-test-send__send-control">
              <Link className="at-btn at-btn--secondary at-btn--sm" to={registrationTabPath(eventId, "legal")}>
                Open Legal
              </Link>
            </div>
          )}
        </div>
      </div>
      <span id={hintId} className="at-hint">
        {none ? CONSENTS_NONE_HINT : CONSENTS_HINT}
      </span>
    </div>
  );
}

type CardProps = Readonly<{ draft: AccessDraft; disabled: boolean; onChange: (change: FormChange) => void }>;

/** What guests fill in: the questions (the company, the department, one more person, and the event's own on the Fields tab), how the boxes look, and the extra consents. */
export function AccessFormCard({ eventId, draft, legalItems, disabled, onChange }: CardProps & Readonly<{ eventId: string; legalItems: readonly LegalDocumentDto[] }>) {
  const row = (name: ToggleKey) => <ToggleRow name={name} draft={draft} disabled={disabled} onChange={onChange} />;
  return (
    <Card title="Form">
      <div className="settings-card-stack">
        <p className="settings-card-intro">The questions on the form, how it looks, and the consents guests agree to.</p>
        <div className="access-form-groups">
          <Group label="Questions">
            {row("ask_company")}
            {row("ask_department")}
            {row("companion")}
            <GoToRow title="Your own questions" text="Add or change them on the Fields tab." label="Open Fields" to={registrationTabPath(eventId, "fields")} />
          </Group>
          <Group label="Look">{row("styled_form_controls")}</Group>
          <Group label="Consents">
            <ConsentsField eventId={eventId} draft={draft} legalItems={legalItems} disabled={disabled} onChange={onChange} />
          </Group>
        </div>
      </div>
    </Card>
  );
}

/** How a new request is handled: the confirmation of the address, the decision by hand, and the waiting list. */
export function AccessAfterFormCard({ draft, disabled, onChange }: CardProps) {
  return (
    <Card title="Handling requests">
      <div className="settings-card-stack">
        <p className="settings-card-intro">Decide how new requests are checked and accepted.</p>
        <div className="access-form-group__rows">
          <ToggleRow name="verify_email" draft={draft} disabled={disabled} onChange={onChange} />
          <ApprovalRow draft={draft} disabled={disabled} onChange={onChange} />
          <ToggleRow name="waitlist_enabled" draft={draft} disabled={disabled} onChange={onChange} />
        </div>
      </div>
    </Card>
  );
}
