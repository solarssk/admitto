import type { ReactNode } from "react";
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

/** The extra consents a guest must accept, chosen from the texts the event has published (the Legal tab writes them). One that is chosen and not published stays in the list, marked, so that it can be taken off. */
function ConsentsField({ eventId, draft, legalItems, disabled, onChange }: Readonly<{ eventId: string; draft: AccessDraft; legalItems: readonly LegalDocumentDto[]; disabled: boolean; onChange: (change: FormChange) => void }>) {
  const options = consentOptions(legalItems, draft.consent_keys);
  return (
    <div className="access-consents">
      <MultiSelect
        id="access-consents"
        label="Extra consents"
        placeholder="None"
        searchPlaceholder="Search consents"
        emptyLabel="No consents found"
        value={draft.consent_keys}
        options={options}
        disabled={disabled || options.length === 0}
        hint="Each consent you choose adds a checkbox to the form. The privacy notice and the terms are always there."
        onChange={(ids) => onChange({ consent_keys: ids })}
      />
      {options.length === 0 && (
        <p className="settings-card-intro">
          No extra consent is published for this event.{" "}
          <Link to={registrationTabPath(eventId, "legal")}>Write and publish one on the Legal tab.</Link>
        </p>
      )}
    </div>
  );
}

/**
 * What the form asks, in two cards: how requests are taken (approval, the waiting list, the confirmation of the address, a companion)
 * and the questions and consents on the form (beyond the questions of the Fields tab).
 */
export function AccessFormCards({
  eventId,
  draft,
  legalItems,
  disabled,
  onChange,
}: Readonly<{
  eventId: string;
  draft: AccessDraft;
  legalItems: readonly LegalDocumentDto[];
  disabled: boolean;
  onChange: (change: FormChange) => void;
}>) {
  const row = (name: ToggleKey) => <ToggleRow name={name} draft={draft} disabled={disabled} onChange={onChange} />;
  return (
    <>
      <Card title="Requests and limits">
        <div className="access-form-groups">
          <Group label="Requests">
            <ApprovalRow draft={draft} disabled={disabled} onChange={onChange} />
            {row("waitlist_enabled")}
          </Group>
          <Group label="Who can register">
            {row("verify_email")}
            {row("companion")}
          </Group>
        </div>
      </Card>
      <Card title="Questions and consents">
        <div className="access-form-groups">
          <Group label="Questions">
            {row("ask_company")}
            {row("ask_department")}
            <p className="settings-card-intro">
              <Link to={registrationTabPath(eventId, "fields")}>Add or change your own questions on the Fields tab.</Link>
            </p>
          </Group>
          <Group label="Look">{row("styled_form_controls")}</Group>
          <Group label="Consents">
            <ConsentsField eventId={eventId} draft={draft} legalItems={legalItems} disabled={disabled} onChange={onChange} />
          </Group>
        </div>
      </Card>
    </>
  );
}
