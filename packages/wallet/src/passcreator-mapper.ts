import type { WalletPassInput } from "./types.js";

/**
 * Maps Admitto's neutral WalletPassInput to a PassCreator `data` payload.
 *
 * Confirmed live against app.passcreator.com 2026-08-06: `templateId`,
 * `userProvidedId`, and `enforceUniqueUserProvidedId` all live INSIDE the
 * `data` object, not as siblings — `_ops/PASSCREATOR-INTEGRATION-DOCS.md`'s
 * example (siblings) does not match the real API.
 *
 * Custom template fields (`name`/`eventDate`/`eventHours`/`eventPlace`/
 * `ticketType`) are this specific template's keys (ADR 0041 §3a) — a
 * different template would need a different mapper.
 */
export function toPassCreatorData(
  input: WalletPassInput,
  templateId: string,
): Record<string, unknown> {
  return {
    templateId,
    userProvidedId: input.userProvidedId,
    enforceUniqueUserProvidedId: true,
    name: input.attendeeName,
    eventDate: input.eventDateLabel,
    ...(input.eventHoursLabel ? { eventHours: input.eventHoursLabel } : {}),
    ...(input.eventLocationLabel ? { eventPlace: input.eventLocationLabel } : {}),
    ticketType: input.ticketTypeLabel,
  };
}
