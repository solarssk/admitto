import { getCountryDataList, getEmojiFlag } from "countries-list";

/** Country calling codes for the internal staff phone number field (Edit user modal), derived
 * from `countries-list` (already a transitive dependency via ip-location-api, so this adds no
 * new package to the tree) - covers every ISO 3166-1 country/territory with its flag emoji and
 * dial code, not a small hand-picked subset. This field isn't validated or formatted beyond
 * "digits the operator typed", so a full phone-number-parsing library is still more than it
 * needs; this is reference data only. */
export interface PhoneCountry {
  iso2: string;
  name: string;
  dialCode: string;
  flag: string;
}

/** Sorted by name; a handful of countries share a dial code (e.g. US/Canada both +1) - the
 * picker still lists each by its own name/flag, matching how real phone-number pickers work,
 * even though only the dial code itself is ever stored. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = getCountryDataList()
  .map((c) => ({
    iso2: c.iso2,
    name: c.name,
    dialCode: `+${c.phone[0]}`,
    flag: getEmojiFlag(c.iso2),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** First country matching an already-saved dial code, for the picker's own trigger display -
 * arbitrary but stable when several countries share a code (US/Canada, UK/Guernsey/Jersey, ...). */
export function findPhoneCountryByDialCode(dialCode: string): PhoneCountry | undefined {
  return PHONE_COUNTRIES.find((c) => c.dialCode === dialCode);
}

export interface SplitPhoneForPicker {
  dialCode: string;
  nationalNumber: string;
}

/** Splits an existing E.164 contact value for the country picker and national-number input.
 * Longest code wins because shared-code prefixes such as +1 and +1242 must not be ambiguous. */
export function splitPhoneForPicker(phone: string): SplitPhoneForPicker {
  const value = phone.trim();
  const dialCode = [...new Set(PHONE_COUNTRIES.map((country) => country.dialCode))]
    .sort((a, b) => b.length - a.length)
    .find((code) => value.startsWith(code));

  if (!dialCode) return { dialCode: "", nationalNumber: value };
  return { dialCode, nationalNumber: value.slice(dialCode.length).trim() };
}

/** Stores picker input as one E.164-like contact value while preserving a legacy number when
 * the operator does not select a country code. */
export function composePhoneE164(dialCode: string, nationalNumber: string): string {
  const number = nationalNumber.trim();
  if (!dialCode) return number;
  return number ? `${dialCode}${number.replace(/\D/g, "")}` : "";
}
