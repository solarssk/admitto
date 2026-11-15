import type { RegistrationRedirectUriDto } from "../api/types.js";
import { EVENT_ADDRESS_HINT, GATEWAY_NOTE, REDIRECT_HINT, UNVERIFIED_NOTE } from "../settings/registrationSsoTexts.js";
import { RetryHint } from "../components/RetryHint.js";
import { keepLastWords } from "../utils/keep-last-words.js";
import { ItPanel, RecordField } from "./ItSetup.js";

const NO_INSTANCE_ADDRESS = "There is no return address yet, because the Instance URL is not set. Set it under General in Organisation settings.";

/** The host of a return address. */
export function hostOf(uri: string): string {
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
  const which = claim.values.length === 1 ? "this value" : `one of these ${claim.values.length} values`;
  return `The identity provider must send the claim ${claim.name} with ${which}: ${claim.values.join(", ")}. Guests with other values cannot register.`;
}

/** The instructions for the company SSO as plain text, whole in themselves: a person can read them and so can an agent. */
export function ssoInstructionsText(addresses: readonly string[], claim: SavedClaim): string {
  const steps = [
    ...(addresses.length === 0 ? [] : [`At the identity provider, add ${addresses.length === 1 ? "this allowed redirect (callback) address" : "these allowed redirect (callback) addresses"}: ${addresses.join(", ")}`]),
    "If a gateway such as Cloudflare Access stands in front of Admitto, it must let the paths /sso/callback, /r/* and /legal/* through without asking for a sign-in.",
    ...(claim.name === null ? [] : [claimSentence({ ...claim, name: claim.name })]),
  ];
  return [
    "Set up Company SSO (OpenID Connect) for the guest registration of an event in Admitto.",
    "",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Report back when it is done.",
  ].join("\n");
}

/** One return address to enter at the identity provider, in a grey read only box with the button that copies it on its left. */
export function ReturnAddress({ label, uri }: Readonly<{ label: string; uri: string }>) {
  return (
    <div className="access-dns access-dns--single">
      <RecordField label={label} value={uri} placeholder="" copyLabel={`Copy the ${label.toLowerCase()}`} />
    </div>
  );
}

/** The first step: the return address of the instance, or why there is none to show (it could not be read, or the instance has no address). */
function InstanceAddress({
  instanceUri,
  readFailed,
  retrying,
  onRetry,
}: Readonly<{ instanceUri: string | null; readFailed: boolean; retrying: boolean; onRetry: () => void }>) {
  if (readFailed) {
    return <RetryHint message="Could not read the return addresses." busy={retrying} onRetry={onRetry} retryLabel="Retry reading the return addresses" />;
  }
  if (instanceUri === null) return <span>{keepLastWords(NO_INSTANCE_ADDRESS)}</span>;
  return (
    <>
      <span>{keepLastWords(REDIRECT_HINT)}</span>
      <ReturnAddress label="Return address" uri={instanceUri} />
    </>
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
  readFailed,
  retrying,
  onRetry,
}: Readonly<{
  instanceUri: string | null;
  eventUri: RegistrationRedirectUriDto | null;
  claim: SavedClaim;
  /** The return addresses could not be read: that is not the same as the instance having none. */
  readFailed: boolean;
  retrying: boolean;
  onRetry: () => void;
}>) {
  const addresses = [...(instanceUri === null ? [] : [instanceUri]), ...(eventUri === null ? [] : [eventUri.uri])];
  return (
    <ItPanel text={ssoInstructionsText(addresses, claim)}>
      <li>
        <InstanceAddress instanceUri={instanceUri} readFailed={readFailed} retrying={retrying} onRetry={onRetry} />
      </li>
      {eventUri !== null && (
        <li>
          <span>{keepLastWords(eventUri.verified ? EVENT_ADDRESS_HINT : `${EVENT_ADDRESS_HINT}${UNVERIFIED_NOTE}`)}</span>
          <ReturnAddress label={`Return address for ${hostOf(eventUri.uri)}`} uri={eventUri.uri} />
        </li>
      )}
      <li>{keepLastWords(GATEWAY_NOTE)}</li>
      {claim.name !== null && <li>{keepLastWords(claimSentence({ ...claim, name: claim.name }))}</li>}
    </ItPanel>
  );
}
