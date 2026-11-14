import { useState } from "react";
import { Badge, Button, Card, HintLabel, Input, Notice, useToast, type BadgeVariant } from "@admitto/ui";
import { testRegistrationTurnstile } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { MailSecretFieldDto, RegistrationTurnstileDto, RegistrationTurnstileStatus } from "../api/types.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { NO_AUTOFILL_PROPS, SecretFieldRow } from "./mailTransportFormParts.js";
import type { TurnstileDraft } from "./registrationTurnstile.js";

const CARD_HINT =
  "Keeps bots out of the public registration form that guests fill in. Cloudflare sees each guest's IP address and browser details, so name it in your privacy notice.";
const CARD_INTRO =
  "Cloudflare Turnstile checks that a guest on the registration form is not a bot. Without both keys, a public link or password form stays closed.";
const PROVIDER_HINT = "The service that checks a guest is not a bot. Cloudflare Turnstile is the only one for now.";
const PROVIDERS = [{ id: "turnstile", label: "Cloudflare Turnstile" }];
const SITE_KEY_HINT = "The public key of your Turnstile widget. Add the address of this instance to its hostnames in Cloudflare.";
const SECRET_KEY_HINT = "Stays on the server. It is stored encrypted and is never shown again.";
const TEST_FAILED = "Could not test the connection.";
const UNREADABLE_NOTICE =
  "The saved secret key cannot be read, probably because ENCRYPTION_KEY changed. Enter the secret key again.";

const STATUS_BADGE: Record<RegistrationTurnstileStatus, { variant: BadgeVariant; label: string }> = {
  ready: { variant: "ok", label: "Ready" },
  incomplete: { variant: "neutral", label: "Not set up" },
  unreadable: { variant: "warn", label: "Needs attention" },
};

/** Organisation Settings → External services: the Cloudflare Turnstile keys of guest registration.
 * The draft lives in the panel, so the one Save of the page saves it with Weather and Maps. */
export function RegistrationTurnstileCard({
  dto,
  draft,
  onChange,
}: Readonly<{
  dto: RegistrationTurnstileDto;
  draft: TurnstileDraft;
  onChange: (next: TurnstileDraft) => void;
}>) {
  const badge = STATUS_BADGE[dto.status];
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
      actions={<Badge variant={badge.variant}>{badge.label}</Badge>}
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
    </Card>
  );
}
