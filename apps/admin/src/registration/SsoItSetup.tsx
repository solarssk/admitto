import type { RegistrationRedirectUriDto } from "../api/types.js";
import { EVENT_ADDRESS_HINT, GATEWAY_NOTE, REDIRECT_HINT, UNVERIFIED_NOTE } from "../settings/registrationSsoTexts.js";
import { ItPanel, RecordField } from "./ItSetup.js";

const NO_INSTANCE_ADDRESS = "There is no return address for this instance yet, because its address is not set.";

/** The host of a return address. */
function hostOf(uri: string): string {
  return new URL(uri).host;
}

/** The restriction of the company SSO as saved: the claim and its values, or none. */
export interface SavedClaim {
  name: string | null;
  values: readonly string[];
}

/** The return address that belongs to the event's own address, when the event has one and the instance knows it. */
export function eventReturnAddress(uris: readonly RegistrationRedirectUriDto[], ownDomain: string | null): RegistrationRedirectUriDto | null {
  if (ownDomain === null) return null;
  return uris.find((entry) => entry.host === "event_domain" && hostOf(entry.uri) === ownDomain) ?? null;
}

function claimSentence(claim: SavedClaim & { name: string }): string {
  const count = claim.values.length === 1 ? "1 value" : `${claim.values.length} values`;
  return `The sign-in must carry the claim ${claim.name}. Guests may register with one of ${count}: ${claim.values.join(", ")}.`;
}

/** The instructions for the company SSO as plain text, whole in themselves: a person can read them and so can an agent. */
function ssoInstructionsText(addresses: readonly string[], claim: SavedClaim): string {
  const steps = [
    ...(addresses.length === 0 ? [] : [`At the identity provider, add ${addresses.length === 1 ? "this allowed redirect (callback) address" : "these allowed redirect (callback) addresses"}: ${addresses.join(", ")}`]),
    "If a gateway such as Cloudflare Access stands in front of Admitto, let /sso/callback through without a sign-in, together with /r/*.",
    ...(claim.name === null ? [] : [claimSentence({ ...claim, name: claim.name })]),
  ];
  return [
    "Set up the company SSO (OpenID Connect) for the guest registration of an event in Admitto.",
    "",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Report back when it is done.",
  ].join("\n");
}

/** One return address to enter at the identity provider, in a grey read only box with the button that copies it on its left. */
function ReturnAddress({ label, uri }: Readonly<{ label: string; uri: string }>) {
  return (
    <div className="access-dns access-dns--single">
      <RecordField label={label} value={uri} placeholder="" copyLabel={`Copy the ${label.toLowerCase()}`} />
    </div>
  );
}

/**
 * What the organisation's IT department does for the company SSO of this event, as the card of the ways in says it: the return addresses
 * to enter at the identity provider (the instance's, and the event's own when it has one), the gateway, and the claim that was set above.
 */
export function SsoItSetup({
  instanceUri,
  eventUri,
  claim,
}: Readonly<{ instanceUri: string | null; eventUri: RegistrationRedirectUriDto | null; claim: SavedClaim }>) {
  const addresses = [...(instanceUri === null ? [] : [instanceUri]), ...(eventUri === null ? [] : [eventUri.uri])];
  return (
    <ItPanel text={ssoInstructionsText(addresses, claim)}>
      <li>
        {instanceUri === null ? (
          <span>{NO_INSTANCE_ADDRESS}</span>
        ) : (
          <>
            <span>{REDIRECT_HINT}</span>
            <ReturnAddress label="Return address" uri={instanceUri} />
          </>
        )}
      </li>
      {eventUri !== null && (
        <li>
          <span>{eventUri.verified ? EVENT_ADDRESS_HINT : `${EVENT_ADDRESS_HINT}${UNVERIFIED_NOTE}`}</span>
          <ReturnAddress label={`Return address for ${hostOf(eventUri.uri)}`} uri={eventUri.uri} />
        </li>
      )}
      <li>{GATEWAY_NOTE}</li>
      {claim.name !== null && <li>{claimSentence({ ...claim, name: claim.name })}</li>}
    </ItPanel>
  );
}
