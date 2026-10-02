import { fetchAdminOrganizations } from "../api/client.js";
import { orLoginRedirect } from "../identity/loginRedirect.js";
import { useOptionsLoad } from "./useOptionsLoad.js";

const fetchOrganizationsOrLogin = orLoginRedirect(fetchAdminOrganizations);

/**
 * The organizations that a picker offers, read while `enabled`; a failure says so, with a Retry (see `useOptionsLoad`).
 * With `redirectOnUnauthorized`, a 401 hands the browser to the login page instead (see `useEventOptions`).
 */
export function useOrganizationOptions(enabled = true, { redirectOnUnauthorized = false }: { redirectOnUnauthorized?: boolean } = {}) {
  const { items, ...rest } = useOptionsLoad(
    redirectOnUnauthorized ? fetchOrganizationsOrLogin : fetchAdminOrganizations,
    "Could not load organizations.",
    enabled,
  );
  return { organizations: items, ...rest };
}
