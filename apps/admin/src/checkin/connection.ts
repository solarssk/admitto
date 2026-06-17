import type { ConnectionState } from "../connection/types.js";

export function canMutateCheckin(state: ConnectionState): boolean {
  return state === "connected";
}
