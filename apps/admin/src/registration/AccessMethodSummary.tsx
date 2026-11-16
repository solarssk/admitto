import { Link } from "react-router";
import { Card } from "@admitto/ui";
import type { RegistrationSettingsDto } from "../api/types.js";
import { keepLastWords } from "../utils/keep-last-words.js";
import type { AccessMethod } from "./accessSettings.js";
import { PROVIDER_TURNED_OFF } from "./ssoProviderChoice.js";
import "./registration-access.css";

const METHOD_LABEL: Readonly<Record<AccessMethod, string>> = { link: "Link", password: "Password", sso: "Company SSO" };

/** The second line of the card: what the method means, and for Company SSO which identity provider guests sign in with. */
function detail(method: AccessMethod | null, provider: RegistrationSettingsDto["sso_provider"]): string {
  if (method === null) return "No access method is chosen yet. Guests cannot open the form.";
  if (method === "link") return "Anyone who has the link can ask to join.";
  if (method === "password") return "Guests need the link and the event password to open the form.";
  if (provider?.display_name) return `Identity provider: ${provider.display_name}${provider.state === "disabled" ? PROVIDER_TURNED_OFF : ""}`;
  return "No identity provider is chosen yet.";
}

/**
 * How guests open the form, as the event has it now, to read. A superadmin sets it in Event settings, Registration: a superadmin gets a
 * "Change" link there in the header of the card, anybody else is told who sets it.
 */
export function AccessMethodSummary({
  eventId,
  method,
  provider,
  isSuperadmin,
}: Readonly<{
  eventId: string;
  method: AccessMethod | null;
  provider: RegistrationSettingsDto["sso_provider"];
  isSuperadmin: boolean;
}>) {
  const change = isSuperadmin ? <Link to={`/admin/events/${encodeURIComponent(eventId)}/settings?tab=registration`}>Change</Link> : undefined;
  return (
    <Card title="Access method" actions={change}>
      <div className="settings-card-stack">
        <div className="settings-row access-method-read">
          <div className="settings-row__text">
            <strong>{method === null ? "Not chosen" : METHOD_LABEL[method]}</strong>
            <p>{keepLastWords(detail(method, provider))}</p>
          </div>
        </div>
        {!isSuperadmin && <p className="settings-card-intro">Set by a superadmin in Event settings, Registration.</p>}
      </div>
    </Card>
  );
}
