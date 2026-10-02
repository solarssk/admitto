import { fetchAdminOrganizations } from "../api/client.js";
import { useOptionsLoad } from "./useOptionsLoad.js";

/** The organizations that a picker offers, read while `enabled`; a failure says so, with a Retry (see `useOptionsLoad`). */
export function useOrganizationOptions(enabled = true) {
  const { items, ...rest } = useOptionsLoad(fetchAdminOrganizations, "Could not load organizations.", enabled);
  return { organizations: items, ...rest };
}
