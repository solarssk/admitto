import { useState } from "react";
import { Button, Card, HintLabel, Input, Notice, Switch, useToast } from "@admitto/ui";
import { testRegistrationTurnstile } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { MailSecretFieldDto, RegistrationTurnstileDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { NO_AUTOFILL_PROPS, SecretFieldRow } from "./mailTransportFormParts.js";
import type { TurnstileDraft } from "./registrationTurnstile.js";

const CARD_HINT =
  "Keeps bots out of the public registration form that guests fill in. Cloudflare sees each guest's IP address and browser details, so name it in your privacy notice.";
const CARD_INTRO =
  "Cloudflare Turnstile checks that a guest on the registration form is not a bot. Without both keys, a public link or password form stays closed.";
const CONFIRM_MESSAGE =
  "After you save, guests are no longer checked for bots. For an event that needs a firm barrier, use the company sign-in or a strong password.";
const PROVIDER_HINT = "The service that checks a guest is not a bot. Cloudflare Turnstile is the only one for now.";
const PROVIDERS = [{ id: "turnstile", label: "Cloudflare Turnstile" }];
const SITE_KEY_HINT = "The public key of your Turnstile widget. Add the address of this instance to its hostnames in Cloudflare.";
const SECRET_KEY_HINT = "Stays on the server. It is stored encrypted and is never shown again.";
const TEST_FAILED = "Could not test the connection.";
const UNREADABLE_NOTICE =
  "The saved secret key cannot be read, probably because ENCRYPTION_KEY changed. Enter the secret key again.";

/** Organisation Settings → External services: whether the organisation uses a bot check on guest registration at all (the Switch,
 * like Maps and Weather), and the provider and Cloudflare Turnstile keys of it. The draft lives in the panel, so the one Save of the
 * page saves it with Weather and Maps. Switching it off asks first. */
export function RegistrationTurnstileCard({
  dto,
  draft,
  disabled = false,
  onChange,
}: Readonly<{
  dto: RegistrationTurnstileDto;
  draft: TurnstileDraft;
  /** True while Save is running: a change made now would be overwritten by the answer. */
  disabled?: boolean;
  onChange: (next: TurnstileDraft) => void;
}>) {
  const [confirming, setConfirming] = useState(false);
  const required = draft.botProtection === "required";
  const secretField: MailSecretFieldDto = {
    set: dto.secret_set,
    masked: dto.secret_set ? "••••" : null,
    source: "db",
    locked: false,
  };
  const { addToast } = useToast();
  const [testing, setTesting] = useState(false);
  const setSecret = (mode: TurnstileDraft["secret"]["mode"], value: string) =>
    onChange({ ...draft, secret: { mode, value } });

  // Turning the check on needs no question; turning it off does.
  const chooseOn = (on: boolean) => {
    if (on) onChange({ ...draft, botProtection: "required" });
    else setConfirming(true);
  };

  async function handleTest() {
    const typed = draft.secret.mode === "replace" ? draft.secret.value.trim() : "";
    setTesting(true);
    try {
      const result = await testRegistrationTurnstile(typed === "" ? {} : { secret_key: typed });
      addToast(result.ok ? (result.message ?? "Connected.") : (result.error ?? TEST_FAILED), result.ok ? "success" : "error");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, TEST_FAILED), "error");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card
      title={<HintLabel hint={CARD_HINT}>Bot protection</HintLabel>}
      actions={
        <Switch
          id="external-bot-protection-enabled"
          label={required ? "On" : "Off"}
          checked={required}
          disabled={disabled}
          onChange={(e) => chooseOn(e.target.checked)}
        />
      }
    >
      <div className="settings-card-stack">
        <p className="settings-card-intro">{CARD_INTRO}</p>
        {dto.status === "unreadable" && <Notice variant="warning">{UNREADABLE_NOTICE}</Notice>}
        <div className="mail-transport-section">
          <div className="mail-field-row">
            <div className="at-field">
              <span className="at-label">
                <HintLabel hint={PROVIDER_HINT}>Provider</HintLabel>
              </span>
              <div className="external-provider-and-test">
                <SearchableSelect
                  id="external-bot-protection-provider"
                  label="Provider"
                  placeholder="Select provider…"
                  searchPlaceholder="Search providers…"
                  emptyLabel="No providers found"
                  showLabel={false}
                  value="turnstile"
                  options={PROVIDERS}
                  disabled
                  onChange={() => undefined}
                />
                <Button
                  type="button"
                  variant="secondary"
                  loading={testing}
                  loadingLabel="Testing…"
                  onClick={() => void handleTest()}
                  icon={<i className="ti ti-plug" aria-hidden="true" />}
                >
                  Test connection
                </Button>
              </div>
            </div>
          </div>
          <Input
            id="external-turnstile-site-key"
            name="turnstile-site-key"
            label="Site key"
            hint={SITE_KEY_HINT}
            value={draft.siteKey}
            {...NO_AUTOFILL_PROPS}
            onChange={(e) => onChange({ ...draft, siteKey: e.target.value })}
          />
          <SecretFieldRow
            id="external-turnstile-secret-key"
            label="Secret key"
            hint={SECRET_KEY_HINT}
            field={secretField}
            edit={draft.secret}
            onReplace={() => setSecret("replace", "")}
            onClear={() => setSecret("clear", "")}
            onValueChange={(value) => setSecret("replace", value)}
            onCancel={() => setSecret("idle", "")}
          />
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        icon={<i className="ti ti-shield-off" />}
        title="Turn the bot check off?"
        message={CONFIRM_MESSAGE}
        confirmLabel="Turn off"
        confirmVariant="warning"
        onConfirm={() => {
          setConfirming(false);
          onChange({ ...draft, botProtection: "not_used" });
        }}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}
