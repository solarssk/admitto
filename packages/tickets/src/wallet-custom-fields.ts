import type { PrismaClient } from "@admitto/db";
import { loadEventCustomDataFields } from "./event-custom-fields.js";
import { customDataValue } from "./custom-data.js";

/** Prefix for a wallet field-mapping placeholder id backed by an EventCustomField, distinguishing
 * it from the fixed WALLET_MAPPING_PLACEHOLDERS vocabulary (packages/wallet/src/
 * passcreator-mapper.ts) - these are per-event, not shared across every event like the rest. */
export const WALLET_CUSTOM_FIELD_PLACEHOLDER_PREFIX = "custom:";

/** Only select (dictionary) and boolean custom fields are exposed to wallet field mapping - free
 * text is excluded (unpredictable length/content for a pass card), per ROADMAP.md's v0.7.1 scope. */
const WALLET_MAPPABLE_CUSTOM_FIELD_TYPES = new Set(["select", "boolean"]);

/**
 * Builds the `{ "custom:<source_field>": "<display value>" }` bag for one attendee's wallet pass,
 * covering only the event's select/boolean custom fields the attendee actually has an answer for.
 * A separate, explicit step before buildWalletPassInput (packages/tickets/src/wallet-pass-input.ts)
 * - same shape as resolveTicketPageDisplay's own ticket_type resolution - so buildWalletPassInput
 * itself stays a pure, db-free function.
 *
 * A field deleted or retyped to `text` after being mapped simply stops appearing here, so
 * toPassCreatorData (packages/wallet/src/passcreator-mapper.ts) silently sends nothing for that
 * key - the same "stale mapping goes quiet" behavior every other wallet placeholder already has,
 * not a new failure mode.
 */
export async function resolveWalletCustomFieldPlaceholders(
  db: PrismaClient,
  eventId: string,
  attendeeCustomData: unknown,
): Promise<Record<string, string>> {
  const fields = await loadEventCustomDataFields(db, eventId);
  const out: Record<string, string> = {};
  for (const field of fields) {
    if (!field.type || !WALLET_MAPPABLE_CUSTOM_FIELD_TYPES.has(field.type)) continue;
    const raw = customDataValue(attendeeCustomData, field.source_field);
    if (!raw) continue;
    const value = field.type === "boolean" ? (raw === "true" ? "Yes" : "No") : raw;
    out[`${WALLET_CUSTOM_FIELD_PLACEHOLDER_PREFIX}${field.source_field}`] = value;
  }
  return out;
}
