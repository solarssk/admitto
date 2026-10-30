import { Link } from "react-router";
import { Card, Switch } from "@admitto/ui";
import type { LegalDocumentDto } from "../api/types.js";
import { MultiSelect } from "../components/MultiSelect.js";
import { consentOptions, type AccessDraft } from "./accessSettings.js";
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
    text: "A phone number gets the product's own box, with a list of countries beside it, instead of the one in the guest's browser. Date and time boxes stay the browser's. Turned off, guests get their browser's boxes.",
  },
];

/**
 * What the form asks beyond the questions of the Fields tab: the switches of the form, and the extra consents a guest must accept.
 * The consents are chosen from the texts the event has published (the Legal tab writes them); one that is chosen and not published
 * stays in the list, marked, so that it can be taken off.
 */
export function AccessFormCard({
  draft,
  legalItems,
  disabled,
  onChange,
}: Readonly<{
  draft: AccessDraft;
  legalItems: readonly LegalDocumentDto[];
  disabled: boolean;
  onChange: (change: Partial<Pick<AccessDraft, ToggleKey | "consent_keys">>) => void;
}>) {
  const options = consentOptions(legalItems, draft.consent_keys);
  return (
    <Card title="Form">
      {TOGGLES.map(({ key, title, text }) => (
        <div key={key} className="settings-row settings-row--switch">
          <div className="settings-row__text">
            <strong>{title}</strong>
            <p>{text}</p>
          </div>
          <Switch checked={draft[key]} disabled={disabled} aria-label={title} onChange={(event) => onChange({ [key]: event.target.checked })} />
        </div>
      ))}
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
            <Link to={{ search: "?tab=legal" }} replace>
              Write and publish one on the Legal tab.
            </Link>
          </p>
        )}
      </div>
    </Card>
  );
}
