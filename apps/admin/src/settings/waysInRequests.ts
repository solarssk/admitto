import { fetchRegistrationAccessMethods, fetchRegistrationSsoProvider, saveRegistrationAccessMethods, saveRegistrationSsoProvider } from "../api/client.js";
import {
  buildAccessMethodsSaveBody,
  buildSsoProviderSaveBody,
  type AccessMethodsDraft,
  type WaysIn,
  type WaysInSaved,
} from "./registrationAccessMethods.js";

/** The ways in of the instance and the provider of the company sign-in, read together: the card shows both. */
export async function fetchWaysIn(signal?: AbortSignal): Promise<WaysIn> {
  const [methods, sso] = await Promise.all([fetchRegistrationAccessMethods(signal), fetchRegistrationSsoProvider(signal)]);
  return { methods, sso };
}

/** What a save of the Ways in card got: the answer of each request that worked, and the reason of each that did not. */
export interface WaysInSaveResult {
  saved: WaysInSaved;
  failures: unknown[];
}

/** The result of a save that had no part of the card to send. */
export const NOTHING_SAVED: WaysInSaveResult = { saved: { methods: null, sso: null }, failures: [] };

/**
 * Saves the part of the card that changed: the list of ways that are on, and the provider, as two requests. The order does not
 * matter, since a way that is on without a provider is only unavailable. Neither request undoes the other when one fails, and
 * the result keeps what each got, so that the screen shows the part that was saved as saved and the other as still changed.
 */
export async function saveWaysIn(draft: AccessMethodsDraft, saved: AccessMethodsDraft): Promise<WaysInSaveResult> {
  const methodsBody = buildAccessMethodsSaveBody(draft, saved);
  const providerBody = buildSsoProviderSaveBody(draft, saved);
  const [methods, sso] = await Promise.allSettled([
    methodsBody ? saveRegistrationAccessMethods(methodsBody) : Promise.resolve(null),
    providerBody ? saveRegistrationSsoProvider(providerBody) : Promise.resolve(null),
  ]);
  const failures = [methods, sso].filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason as unknown);
  return {
    saved: { methods: methods.status === "fulfilled" ? methods.value : null, sso: sso.status === "fulfilled" ? sso.value : null },
    failures,
  };
}
