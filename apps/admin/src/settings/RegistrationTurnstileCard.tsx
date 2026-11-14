import { useState } from "react";
import { Badge, Card, HintLabel, Input, Notice, type BadgeVariant } from "@admitto/ui";
import type {
  MailSecretFieldDto,
  RegistrationBotProtection,
  RegistrationTurnstileDto,
  RegistrationTurnstileStatus,
} from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import { NO_AUTOFILL_PROPS, SecretFieldRow } from "./mailTransportFormParts.js";
import type { TurnstileDraft } from "./registrationTurnstile.js";

const CARD_HINT = "Keeps bots out of the public registration form that guests fill in.";
const CARD_INTRO =
  "Cloudflare Turnstile checks that a guest on the registration form is not a bot. While the check is required, a public link or password form stays closed without both keys.";
const MODE_HINT =
  "Choose Not used for a form that runs inside your own network or for an organisation without Cloudflare. The company sign-in never has a bot check.";
const MODE_RISK =
  "Without the check, anyone who can open the form can send it by script and try an event password as fast as the stricter limits allow.";
const MODE_OPTIONS: ReadonlyArray<SegmentedOption<RegistrationBotProtection>> = [
  { value: "required", label: "Required" },
  { value: "not_used", label: "Not used" },
];
const CONFIRM_MESSAGE =
  "After you save, guests are no longer checked by Cloudflare Turnstile. An event with a public link can then be filled in by a script, and the password of an event can be guessed, with only the stricter limits in the way. For a strong barrier, use the company sign-in.";
const SITE_KEY_HINT = "The public key of your Turnstile widget in the Cloudflare dashboard. Guests' browsers receive it.";
const SECRET_KEY_HINT = "Stays on the server. It is stored encrypted and is never shown again.";
const CLOUDFLARE_NOTE =
  "In Cloudflare, add the address of this instance to the widget's hostnames. Cloudflare sees each guest's IP address and browser details, so name it in your privacy notice.";
const UNREADABLE_NOTICE =
  "The saved secret key cannot be read, probably because ENCRYPTION_KEY changed. Enter the secret key again.";

const STATUS_BADGE: Record<RegistrationTurnstileStatus, { variant: BadgeVariant; label: string }> = {
  ready: { variant: "ok", label: "Ready" },
  incomplete: { variant: "neutral", label: "Not set up" },
  unreadable: { variant: "warn", label: "Needs attention" },
};

/** The badge of the card: the state of the keys while the check is required, "Not used" when it is not. */
function badgeOf(dto: RegistrationTurnstileDto, mode: RegistrationBotProtection): { variant: BadgeVariant; label: string } {
  return mode === "not_used" ? { variant: "neutral", label: "Not used" } : STATUS_BADGE[dto.status];
}

/** Organisation Settings → External services: whether guest registration has a bot check, and the Cloudflare Turnstile keys of it.
 * The draft lives in the panel, so the one Save of the page saves it with Weather and Maps. Choosing "Not used" asks first. */
export function RegistrationTurnstileCard({
  dto,
  draft,
  onChange,
}: Readonly<{
  dto: RegistrationTurnstileDto;
  draft: TurnstileDraft;
  onChange: (next: TurnstileDraft) => void;
}>) {
  const [confirming, setConfirming] = useState(false);
  const required = draft.botProtection === "required";
  const badge = badgeOf(dto, draft.botProtection);
  const secretField: MailSecretFieldDto = {
    set: dto.secret_set,
    masked: dto.secret_set ? "••••" : null,
    source: "db",
    locked: false,
  };
  const setSecret = (mode: TurnstileDraft["secret"]["mode"], value: string) =>
    onChange({ ...draft, secret: { mode, value } });
  // Turning the check back on needs no question; turning it off does.
  const chooseMode = (mode: RegistrationBotProtection) => {
    if (mode === draft.botProtection) return;
    if (mode === "not_used") setConfirming(true);
    else onChange({ ...draft, botProtection: mode });
  };

  return (
    <Card
      title={<HintLabel hint={CARD_HINT}>Guest registration</HintLabel>}
      actions={<Badge variant={badge.variant}>{badge.label}</Badge>}
    >
      <div className="settings-card-stack">
        <p className="settings-card-intro">{CARD_INTRO}</p>
        <div className="at-field">
          <span className="at-label">
            <HintLabel hint={MODE_HINT}>Bot check</HintLabel>
          </span>
          <Segmented
            className="mail-source-toggle"
            options={MODE_OPTIONS}
            value={draft.botProtection}
            ariaLabel="Bot check"
            describedBy="external-bot-protection-risk"
            onChange={chooseMode}
          />
          {!required && (
            <p id="external-bot-protection-risk" className="at-hint">
              {MODE_RISK}
            </p>
          )}
        </div>
        {required && dto.status === "unreadable" && <Notice variant="warning">{UNREADABLE_NOTICE}</Notice>}
        {required && (
          <>
            <div className="mail-transport-section">
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
            <p className="at-hint">{CLOUDFLARE_NOTE}</p>
          </>
        )}
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
