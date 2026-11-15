import { Link } from "react-router";
import { Card } from "@admitto/ui";
import type { RegistrationSettingsDto } from "../api/types.js";
import { keepLastWords } from "../utils/keep-last-words.js";
import type { AccessMethod } from "./accessSettings.js";
import { PROVIDER_TURNED_OFF } from "./ssoProviderChoice.js";
import "./registration-access.css";

const METHOD_LABEL: Readonly<Record<AccessMethod, string>> = { link: "Link", password: "Password", sso: "Company SSO" };

/** The second line of the card: for Company SSO, which identity provider guests sign in with; for the others, nothing more is chosen. */
function detail(method: AccessMethod | null, provider: RegistrationSettingsDto["sso_provider"]): string | null {
  if (method === null) return "No access method is chosen yet. Guests cannot open the form.";
  if (method !== "sso") return null;
  if (provider?.display_name) return `Identity provider: ${provider.display_name}${provider.state === "disabled" ? PROVIDER_TURNED_OFF : ""}`;
  return "No identity provider is chosen yet.";
}

/**
 * How guests open the form, as the event has it now, to read. A superadmin sets it in Event settings, Registration: the card says so,
 * and gives the superadmin the way there.
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
  const more = detail(method, provider);
  return (
    <Card title="Access method">
      <div className="settings-card-stack">
        <div className="access-method-read">
          <strong>{method === null ? "Not chosen" : METHOD_LABEL[method]}</strong>
          {more !== null && <p>{keepLastWords(more)}</p>}
        </div>
        <p className="settings-card-intro">
          {isSuperadmin ? (
            <>
              Change it in <Link to={`/admin/events/${encodeURIComponent(eventId)}/settings?tab=registration`}>Event settings, Registration</Link>.
            </>
          ) : (
            "Set by a superadmin in Event settings, Registration."
          )}
        </p>
      </div>
    </Card>
  );
}
