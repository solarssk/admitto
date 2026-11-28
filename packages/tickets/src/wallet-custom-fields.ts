import type { PrismaClient } from "@admitto/db";
import { loadEventCustomDataFields } from "./event-custom-fields.js";
import { customDataValue } from "./custom-data.js";
import { sensitiveSourceFields, type SensitivityField } from "./sensitive-custom-data.js";

/** Prefix for a wallet field-mapping placeholder id backed by an EventCustomField, distinguishing
 * it from the fixed WALLET_MAPPING_PLACEHOLDERS vocabulary (packages/wallet/src/
 * passcreator-mapper.ts) - these are per-event, not shared across every event like the rest. */
export const WALLET_CUSTOM_FIELD_PLACEHOLDER_PREFIX = "custom:";

/** Only select (dictionary) and boolean custom fields are exposed to wallet field mapping - free
 * input is excluded (text, long text, date, date and time, phone: unpredictable length/content for
 * a pass card), per ROADMAP.md's v0.7.1 scope. An allowlist on purpose: a type added later stays
 * off the pass until someone lists it here. */
const WALLET_MAPPABLE_CUSTOM_FIELD_TYPES = new Set(["select", "boolean"]);

/** Whether a question's answer may go on a pass: a select or boolean question that is not sensitive. A sensitive question's answer
 * is never put on a pass (D-E6), even when a mapping saved earlier still names it. */
function isWalletMappable(field: { type?: string; sensitive?: boolean }): boolean {
  return !field.sensitive && !!field.type && WALLET_MAPPABLE_CUSTOM_FIELD_TYPES.has(field.type);
}

/**
 * The `source_field`s that a wallet field mapping points at (`"custom:<source_field>"` values), and that are sensitive (D-E6):
 * a pass is handed to the guest's phone and to the wallet provider, so the answer to a sensitive question never goes on it.
 * The mapping route refuses a mapping with any of them; {@link resolveWalletCustomFieldPlaceholders} skips them whatever the
 * stored mapping says, which covers a mapping saved before the question became sensitive.
 */
export function sensitiveWalletMappingFields(
  mapping: Record<string, string>,
  sensitiveFields: readonly SensitivityField[],
): string[] {
  const sensitive = sensitiveSourceFields(sensitiveFields);
  return [...new Set(walletMappingCustomFields(mapping).filter((sourceField) => sensitive.has(sourceField)))];
}

/** The `source_field`s that a wallet field mapping names (`"custom:<source_field>"` values). */
function walletMappingCustomFields(mapping: Record<string, string>): string[] {
  return Object.values(mapping)
    .filter((value) => value.startsWith(WALLET_CUSTOM_FIELD_PLACEHOLDER_PREFIX))
    .map((value) => value.slice(WALLET_CUSTOM_FIELD_PLACEHOLDER_PREFIX.length));
}

/**
 * Whether a wallet field mapping names the question `sourceField` (any property of the pass). A question that is named cannot
 * become sensitive: its answer may already be on issued passes, and the pass on the guest's phone keeps it until it is updated
 * (D-E6). The organiser takes the question off the mapping first, as for an item.
 */
export function walletMappingNamesField(mapping: Record<string, string> | null, sourceField: string): boolean {
  return mapping !== null && walletMappingCustomFields(mapping).includes(sourceField);
}

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
 *
 * `fieldMapping` (the event's current Event.wallet_field_mapping, ResolvedTicket.event.
 * walletFieldMapping) is checked first so an event with no `custom:`-mapped field skips the
 * EventCustomField query entirely - the caller with the widest blast radius, an event-wide bulk
 * wallet push, would otherwise run this same full-registry read once per attendee for nothing
 * (bot review).
 */
export async function resolveWalletCustomFieldPlaceholders(
  db: PrismaClient,
  eventId: string,
  attendeeCustomData: unknown,
  fieldMapping: Record<string, string> | null,
): Promise<Record<string, string>> {
  const hasCustomFieldMapping = fieldMapping
    ? Object.values(fieldMapping).some((value) => value.startsWith(WALLET_CUSTOM_FIELD_PLACEHOLDER_PREFIX))
    : false;
  if (!hasCustomFieldMapping) return {};

  const fields = await loadEventCustomDataFields(db, eventId);
  const out: Record<string, string> = {};
  for (const field of fields) {
    if (!isWalletMappable(field)) continue;
    const raw = customDataValue(attendeeCustomData, field.source_field);
    if (!raw) continue;
    // A boolean field only ever normalizes to the literal strings "true"/"false"
    // (normalizeCustomDataFieldValue, validate-custom-data.ts) - anything else stored under this
    // source_field predates the field being retyped to boolean (it used to be select/text) and is
    // stale, not a real answer. Treating it as "No" would put a fabricated negative on the pass;
    // omit it instead, same as an attendee who never answered at all (bot review).
    if (field.type === "boolean" && raw !== "true" && raw !== "false") continue;
    // `raw` is already narrowed to "true"/"false" for a boolean field by the guard above.
    let value = raw;
    if (field.type === "boolean") value = raw === "true" ? "Yes" : "No";
    out[`${WALLET_CUSTOM_FIELD_PLACEHOLDER_PREFIX}${field.source_field}`] = value;
  }
  return out;
}
