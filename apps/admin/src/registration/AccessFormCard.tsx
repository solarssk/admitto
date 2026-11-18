import { Link } from "react-router";
import { Card, Switch } from "@admitto/ui";
import type { LegalDocumentDto } from "../api/types.js";
import { MultiSelect } from "../components/MultiSelect.js";
import { consentOptions, type AccessDraft } from "./accessSettings.js";
import { registrationTabPath } from "./registrationTabs.js";
import "./registration-access.css";

type ToggleKey = "waitlist_enabled" | "verify_email" | "ask_company" | "ask_department" | "companion" | "styled_form_controls";

const TOGGLES: ReadonlyArray<{ key: ToggleKey; title: string; text: string }> = [
  {
    key: "waitlist_enabled",
    title: "Waiting list",
    text: "When the event is full, new requests join a waiting list. Turned off, a full event says that no places are left and saves nothing.",
  },
  {
    key: "verify_email",
    title: "Confirm email addresses",
    text: "Guests confirm their address with a link that works for 24 hours. A request that is not confirmed by then is deleted.",
  },
  { key: "ask_company", title: "Ask for the company", text: "Adds a company question to the form." },
  { key: "ask_department", title: "Ask for the department", text: "Adds a department question to the form." },
  { key: "companion", title: "Guests can bring one person", text: "A guest can add one more person. That person takes a place too." },
  {
    key: "styled_form_controls",
    title: "Styled form boxes",
    text: "Dates, times and phone numbers get the product's own boxes instead of the ones in the guest's browser: a calendar for a date, a list of times for a time, and a list of countries beside a phone number. A phone question that allows only digits, or a set length, keeps the browser's box. Turned off, guests get their browser's boxes.",
  },
];

/** What the confirmation switch says under the company SSO: the address comes from the identity provider, so no link is sent. */
const VERIFY_EMAIL_PROVIDER_TEXT =
  "Not used with Company SSO. The address comes from the identity provider, so no confirmation link is sent. Your choice is kept for the other ways.";

/** Whether the provider's sign-in makes this switch meaningless (the server skips the link for the company SSO). */
function providerDecides(key: ToggleKey, draft: AccessDraft): boolean {
  return key === "verify_email" && draft.method === "sso";
}

const APPROVAL_TITLE = "Approve requests by hand";
const APPROVAL_TEXT = "Every request waits on the Requests tab until you accept or reject it. Turned off, guests are accepted without waiting for you, until the event is full.";
const APPROVAL_OFF_TEXT = "You can choose this while registration is on. Turn it on with the switch in the header of the Registration page.";

/** The mode of registration while it is on: with approval, or automatic. It is a switch of the form, since the Registration page only turns registration on or off. */
function ApprovalRow({ draft, disabled, onChange }: Readonly<{ draft: AccessDraft; disabled: boolean; onChange: (change: Partial<Pick<AccessDraft, "mode">>) => void }>) {
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

/**
 * What the form asks beyond the questions of the Fields tab: the switches of the form, and the extra consents a guest must accept.
 * The consents are chosen from the texts the event has published (the Legal tab writes them); one that is chosen and not published
 * stays in the list, marked, so that it can be taken off.
 */
export function AccessFormCard({
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
  onChange: (change: Partial<Pick<AccessDraft, ToggleKey | "consent_keys" | "mode">>) => void;
}>) {
  const options = consentOptions(legalItems, draft.consent_keys);
  return (
    <Card title="Form">
      <ApprovalRow draft={draft} disabled={disabled} onChange={onChange} />
      {TOGGLES.map(({ key, title, text }) => {
        const byProvider = providerDecides(key, draft);
        return (
          <div key={key} className="settings-row settings-row--switch">
            <div className="settings-row__text">
              <strong>{title}</strong>
              <p>{byProvider ? VERIFY_EMAIL_PROVIDER_TEXT : text}</p>
            </div>
            <Switch checked={draft[key]} disabled={disabled || byProvider} aria-label={title} onChange={(event) => onChange({ [key]: event.target.checked })} />
          </div>
        );
      })}
      <p className="settings-card-intro">
        <Link to={registrationTabPath(eventId, "fields")}>
          Add or change your own questions on the Fields tab.
        </Link>
      </p>
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
          hint="Each consent you choose gets its own checkbox on the form. The privacy notice and the terms are always on it."
          onChange={(ids) => onChange({ consent_keys: ids })}
        />
        {options.length === 0 && (
          <p className="settings-card-intro">
            No extra consent is published for this event.{" "}
            <Link to={registrationTabPath(eventId, "legal")}>
              Write and publish one on the Legal tab.
            </Link>
          </p>
        )}
      </div>
    </Card>
  );
}
