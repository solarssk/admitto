import { useNavigate } from "react-router";
import { Button, Card, Notice } from "@admitto/ui";
import type { RegistrationSettingsDto } from "../api/types.js";
import { Segmented } from "../components/Segmented.js";
import { keepLastWords } from "../utils/keep-last-words.js";
import type { AccessMethod } from "./accessSettings.js";
import { METHOD_OPTIONS, methodNotice } from "./AccessWayInCard.js";
import { PROVIDER_TURNED_OFF } from "./ssoProviderChoice.js";
import { ssoProviderIcon } from "./ssoProviderKind.js";
import "./registration-access.css";

const NO_METHOD = "No access method is chosen yet. Guests cannot open the form.";

/** The identity provider of Company SSO, with the icon of its kind, as a line under the notice. */
function ProviderLine({ provider }: Readonly<{ provider: RegistrationSettingsDto["sso_provider"] }>) {
  if (!provider?.display_name) return <p className="settings-card-intro">No identity provider is chosen yet.</p>;
  return (
    <p className="settings-card-intro access-method-provider">
      {provider.kind !== null && <i className={`ti ti-${ssoProviderIcon(provider.kind)}`} aria-hidden="true" />}
      <span>
        Identity provider: {provider.display_name}
        {provider.state === "disabled" ? PROVIDER_TURNED_OFF : ""}
      </span>
    </p>
  );
}

/**
 * How guests open the form, as the event has it now, to read: the same choice as in Event settings, Registration, with the chosen
 * method lit and nothing to press. A superadmin sets it there and gets a "Change" button in the header of the card; anybody else is told
 * who sets it.
 */
export function AccessMethodSummary({
  eventId,
  method,
  provider,
  botCheck,
  isSuperadmin,
}: Readonly<{
  eventId: string;
  method: AccessMethod | null;
  provider: RegistrationSettingsDto["sso_provider"];
  /** The organisation checks guests for bots on the link and password forms. */
  botCheck: boolean;
  isSuperadmin: boolean;
}>) {
  const navigate = useNavigate();
  const change = isSuperadmin ? (
    <Button
      variant="secondary"
      size="sm"
      icon={<i className="ti ti-pencil" aria-hidden="true" />}
      onClick={() => void navigate(`/admin/events/${encodeURIComponent(eventId)}/settings?tab=registration`)}
    >
      Change
    </Button>
  ) : undefined;
  return (
    <Card title="Access method" actions={change}>
      <div className="settings-card-stack">
        <Segmented className="access-seg access-seg--read" ariaLabel="Access method" options={METHOD_OPTIONS} value={method} disabled onChange={() => undefined} />
        {method === null ? <Notice variant="warning">{NO_METHOD}</Notice> : <Notice variant="info">{keepLastWords(methodNotice(method, botCheck))}</Notice>}
        {method === "sso" && <ProviderLine provider={provider} />}
        {!isSuperadmin && <span className="at-hint">Set by a superadmin in Event settings, Registration.</span>}
      </div>
    </Card>
  );
}
