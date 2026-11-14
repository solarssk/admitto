import { Card, HintLabel, Notice, Switch } from "@admitto/ui";
import type { RegistrationBotProtection, RegistrationSsoProviderDto, RegistrationTurnstileStatus } from "../api/types.js";
import { RegistrationSsoProviderBlock } from "./RegistrationSsoProviderBlock.js";
import {
  SWITCHED_ACCESS_METHODS,
  TURNSTILE_ACCESS_METHODS,
  type AccessMethodsDraft,
  type SwitchedAccessMethod,
} from "./registrationAccessMethods.js";

const CARD_HINT = "The ways a guest can reach a registration form. An organiser chooses one of the ways that are on for each event.";
const CARD_INTRO =
  "An organiser can choose only a way that is on. Turning one off closes the registration form of every event that uses it, at once: guests see a page that is not found. Nothing is deleted, and turning it on again opens those forms again.";
const KEYS_NOTICE =
  "Forms behind a link or a password stay closed until the Turnstile keys above are ready: both keys saved, and the secret key readable.";

const METHODS: Readonly<Record<SwitchedAccessMethod, { name: string; text: string; textWithoutCheck: string }>> = {
  link: {
    name: "Link",
    text: "Anyone who has the link of an event can open its form, after a bot check.",
    textWithoutCheck: "Anyone who has the link of an event can open its form. There is no bot check.",
  },
  password: {
    name: "Password",
    text: "A guest needs the password of the event, as well as its link, to open the form, after a bot check.",
    textWithoutCheck: "A guest needs the password of the event, as well as its link, to open the form. There is no bot check, so the number of tries is limited more strictly.",
  },
  sso: {
    name: "Company sign-in",
    text: "A guest signs in with the identity provider chosen below to open the form. The sign-in replaces the bot check, and the guest's email comes from the provider.",
    textWithoutCheck: "A guest signs in with the identity provider chosen below to open the form. The guest's email comes from the provider.",
  },
};

/** Organisation Settings → External services: which ways in to the guest registration form are on for the whole instance.
 * The draft lives in the panel, so the one Save of the page saves it with Weather, Maps and the Turnstile keys.
 * `keys` is the saved state of the Turnstile keys: a link or a password is open to guests only while they are ready. `sso` is the
 * saved state of the identity provider choice, which only the company sign-in needs. `botProtection` is the saved mode of the bot
 * check: with `not_used` the link and the password need no keys, and their text says there is no check. */
export function RegistrationAccessMethodsCard({
  draft,
  keys,
  botProtection,
  sso,
  disabled,
  onChange,
}: Readonly<{
  draft: AccessMethodsDraft;
  keys: RegistrationTurnstileStatus;
  botProtection: RegistrationBotProtection;
  sso: RegistrationSsoProviderDto;
  /** The Save of the page is on its way: the switches are off, so that its answer cannot replace an edit made meanwhile. */
  disabled: boolean;
  onChange: (next: AccessMethodsDraft) => void;
}>) {
  const checked = botProtection === "required";
  const needsKeys = checked && TURNSTILE_ACCESS_METHODS.some((method) => draft[method]);
  return (
    <Card title={<HintLabel hint={CARD_HINT}>Ways in</HintLabel>}>
      <div className="settings-card-stack">
        <p className="settings-card-intro">{CARD_INTRO}</p>
        <div className="mail-transport-section">
          {SWITCHED_ACCESS_METHODS.map((method) => (
            <div key={method} className="settings-row settings-row--switch">
              <div className="settings-row__text">
                <strong>{METHODS[method].name}</strong>
                <p id={`external-access-${method}-text`}>{checked ? METHODS[method].text : METHODS[method].textWithoutCheck}</p>
              </div>
              <div className="settings-row__controls">
                <Switch
                  id={`external-access-${method}`}
                  aria-label={METHODS[method].name}
                  aria-describedby={`external-access-${method}-text`}
                  label={draft[method] ? "On" : "Off"}
                  checked={draft[method]}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...draft, [method]: e.target.checked })}
                />
              </div>
            </div>
          ))}
        </div>
        {draft.sso && (
          <RegistrationSsoProviderBlock
            sso={sso}
            providerId={draft.ssoProviderId}
            disabled={disabled}
            onChange={(ssoProviderId) => onChange({ ...draft, ssoProviderId })}
          />
        )}
        {needsKeys && keys !== "ready" && <Notice variant="warning">{KEYS_NOTICE}</Notice>}
      </div>
    </Card>
  );
}
