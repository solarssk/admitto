import { Badge, Card, HintLabel, Input, Notice, type BadgeVariant } from "@admitto/ui";
import type { MailSecretFieldDto, RegistrationTurnstileDto, RegistrationTurnstileStatus } from "../api/types.js";
import { NO_AUTOFILL_PROPS, SecretFieldRow } from "./mailTransportFormParts.js";
import type { TurnstileDraft } from "./registrationTurnstile.js";

const CARD_HINT = "Keeps bots out of the public registration form that guests fill in.";
const CARD_INTRO =
  "Cloudflare Turnstile checks that a guest on the registration form is not a bot. Without both keys, a public link or password form stays closed.";
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
  const setSecret = (mode: TurnstileDraft["secret"]["mode"], value: string) =>
    onChange({ ...draft, secret: { mode, value } });

  return (
    <Card
      title={<HintLabel hint={CARD_HINT}>Guest registration</HintLabel>}
      actions={<Badge variant={badge.variant}>{badge.label}</Badge>}
    >
      <div className="settings-card-stack">
        <p className="settings-card-intro">{CARD_INTRO}</p>
        {dto.status === "unreadable" && <Notice variant="warning">{UNREADABLE_NOTICE}</Notice>}
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
      </div>
    </Card>
  );
}
