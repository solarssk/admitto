import type { EnabledWalletPlatforms } from "@admitto/shared";

/**
 * Whether the attendee page has a Wallet chip in its status strip: when the event offers any wallet platform. Deliberately not
 * `platforms.any` (Apple and Google only, see its own doc comment): the chip reads real registration data for Samsung the same way
 * it does for Apple and Google, so a Samsung-only event gets one too. The page's strip and its placeholder both ask this one question, so
 * that the placeholder draws the chips the page will have and nothing moves when the record arrives (one chip fewer is a row fewer
 * on a phone, where the strip is two columns wide).
 */
export function hasWalletStatusChip(platforms: EnabledWalletPlatforms): boolean {
  return platforms.apple || platforms.google || platforms.samsung;
}
