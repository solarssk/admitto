import { z } from "zod";
import { isErasedPlaceholderEmail } from "./erase-attendees.js";
import { buildCustomDataFromInput } from "./validate-custom-data.js";
import { filterCustomDataAttributeFields } from "./custom-data-reserved.js";
import type { EventItemContent } from "./types.js";

/** Per-event cap on custom attendee data field definitions - same placement/rationale as
 * MAX_IMAGE_ASSETS_PER_EVENT (bounds growth, generous for real use). Also the most keys an
 * anonymous registrant payload may carry: one answer per field. */
export const MAX_CUSTOM_FIELDS_PER_EVENT = 20;

/** First and last name, each. Matches the staff attendee schema. */
export const REGISTRANT_NAME_MAX = 100;
/** Same ceiling as the staff attendee schema (RFC 5321 forward-path limit). */
export const REGISTRANT_EMAIL_MAX = 254;
/** Short text answer, and the company and department fixed fields. Matches the custom_data value
 * limit that already applies to staff input. */
export const REGISTRANT_TEXT_MAX = 100;
/** Longest raw string looked at before any normalisation: hostile input is refused outright
 * instead of being walked, normalised and then rejected. */
const REGISTRANT_RAW_MAX = 1000;

/** Thrown for any registrant payload the boundary refuses. The message is a fixed code: it never
 * carries a field key, a value or a library message, so it can be logged and mapped to the generic
 * `validation_failed` answer without leaking input. */
export class RegistrantInputError extends Error {
  constructor() {
    super("validation_failed");
    this.name = "RegistrantInputError";
  }
}

// Characters that are invisible or reorder text: soft hyphen, Arabic letter mark, Mongolian vowel
// separator, zero-width and directional marks (U+200B..U+200F), line and paragraph separators,
// bidi embeddings and overrides (U+202A..U+202E), invisible operators (U+2060..U+2064), bidi
// isolates and deprecated format controls (U+2066..U+206F), BOM / zero-width no-break space,
// interlinear annotation marks, and the two noncharacters at the end of the BMP.
const INVISIBLE_BMP_RANGES: readonly (readonly [number, number])[] = [
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0xfffe, 0xffff],
];

function isInvisibleBmp(unit: number): boolean {
  for (const [from, to] of INVISIBLE_BMP_RANGES) {
    if (unit >= from && unit <= to) return true;
  }
  return false;
}

/** True when `value` holds a C0 or C1 control (NUL, CR, LF, tab, DEL...), an invisible or
 * bidi-reordering character, a Unicode tag character, or a UTF-16 surrogate that is not half of
 * a valid pair. A loop, not a regex: no backtracking, no control characters in a pattern. */
function hasForbiddenCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit < 0x20 || (unit >= 0x7f && unit <= 0x9f)) return true;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      // NaN at the end of the string fails both comparisons: a trailing high surrogate is lone.
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      const codePoint = value.codePointAt(i) ?? 0;
      if (codePoint >= 0xe0000 && codePoint <= 0xe007f) return true;
      i += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return true;
    if (isInvisibleBmp(unit)) return true;
  }
  return false;
}

function codePointLength(value: string): number {
  let length = 0;
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) i += 1;
    length += 1;
  }
  return length;
}

/** Trim, NFC-normalise and check one piece of registrant text. Returns the clean value, or null
 * when it is not a string, is longer than `max` code points (refused, never cut) or holds a
 * forbidden character. An empty result is returned as "" - callers decide if that is allowed. */
export function normalizeRegistrantText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string" || raw.length > REGISTRANT_RAW_MAX) return null;
  // Checked before normalising: NFC leaves a lone surrogate or a control character as it was, and
  // the rule is cheaper to read on the text as it arrived.
  if (hasForbiddenCharacter(raw)) return null;
  const clean = raw.trim().normalize("NFC");
  return codePointLength(clean) > max ? null : clean;
}

/** Zod schema for one piece of registrant text (see normalizeRegistrantText). Empty allowed. */
export function registrantTextSchema(max: number = REGISTRANT_TEXT_MAX) {
  return z.string().transform((raw, ctx) => {
    const clean = normalizeRegistrantText(raw, max);
    if (clean === null) {
      ctx.addIssue({ code: "custom", message: "invalid_text" });
      return z.NEVER;
    }
    return clean;
  });
}

/** A name part: 1 to 100 characters, no URL, no `@`. A name is copied into mail, badges and the
 * staff queue, so a link or an address in it is a phishing carrier, not a name. */
export const registrantNameSchema = registrantTextSchema(REGISTRANT_NAME_MAX).refine(
  (value) => value.length > 0 && !looksLikeLinkOrAddress(value),
  "invalid_name",
);

function looksLikeLinkOrAddress(value: string): boolean {
  if (value.includes("@") || value.includes("://")) return true;
  const lower = value.toLowerCase();
  return lower.includes("www.") || /\b(?:mailto|javascript|data):/.test(lower);
}

/** An e-mail address as stored: trimmed, lower case, at most 254 characters, a valid address, and
 * not in the namespace reserved for erased attendees (such a row would be refused by a CHECK on
 * live attendees when the registration is admitted). Lower case matters because the unique index
 * on (event, email) is case sensitive. */
export const registrantEmailSchema = z
  .string()
  .transform((raw, ctx) => {
    const clean = normalizeRegistrantText(raw, REGISTRANT_EMAIL_MAX);
    if (clean === null) {
      ctx.addIssue({ code: "custom", message: "invalid_email" });
      return z.NEVER;
    }
    return clean.toLowerCase();
  })
  .pipe(z.email().max(REGISTRANT_EMAIL_MAX))
  .refine((value) => !isErasedPlaceholderEmail(value), "reserved_address");

/** A custom field as the public form sees it: the registry row plus the two columns that decide
 * whether an anonymous registrant may answer it. `applies_to` is absent until companions exist and
 * then means `guest`. */
export type RegistrantFormField = EventItemContent & {
  show_on_form: boolean;
  applies_to?: "guest" | "companion";
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

/** Read one answer. Only the declared field keys are ever looked up (own properties only), so the
 * payload's own keys - `__proto__`, `constructor`, anything - are never used as an index. */
function answerFor(field: EventItemContent, raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "boolean") {
    // A checkbox posts a JSON boolean; the stored form is the strings 'true' and 'false'.
    if (field.type !== "boolean") throw new RegistrantInputError();
    return raw ? "true" : "false";
  }
  if (typeof raw !== "string") throw new RegistrantInputError();
  if (field.type === "select" || field.type === "boolean") {
    // Compared against the allowed values by buildCustomDataFromInput; only the size is capped.
    if (raw.length > REGISTRANT_RAW_MAX) throw new RegistrantInputError();
    return raw;
  }
  const clean = normalizeRegistrantText(raw, REGISTRANT_TEXT_MAX);
  if (clean === null) throw new RegistrantInputError();
  return clean;
}

/** Turn the `custom_data` of an anonymous registration into the map that is stored.
 *
 * Only keys of fields that are on the form (`show_on_form`) and for `appliesTo` are read; every
 * other key (import-only fields, hidden fields, `__proto__`, `company` and `department`, anything
 * unknown) is dropped without an error. A payload with more keys than an event may have fields is
 * refused before anything is read. A text answer longer than the limit is refused, not cut.
 * Required fields on the form must be answered. Any failure throws {@link RegistrantInputError}. */
export function buildRegistrantCustomData(
  fields: readonly RegistrantFormField[],
  input: unknown,
  appliesTo: "guest" | "companion" = "guest",
): Record<string, string> | undefined {
  if (input !== undefined && input !== null && !isPlainRecord(input)) {
    throw new RegistrantInputError();
  }
  if (input && Object.keys(input).length > MAX_CUSTOM_FIELDS_PER_EVENT) {
    throw new RegistrantInputError();
  }

  // company and department are fixed fields now, never custom_data (see pickRegistrantProfileFields).
  const onForm = filterCustomDataAttributeFields(
    fields.filter((field) => field.show_on_form && (field.applies_to ?? "guest") === appliesTo),
  );
  const answers: Record<string, unknown> = {};
  for (const field of onForm) {
    const answer = input ? answerFor(field, ownValue(input, field.source_field)) : undefined;
    if (answer !== undefined) {
      Object.defineProperty(answers, field.source_field, {
        value: answer,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }

  try {
    return buildCustomDataFromInput(onForm, answers);
  } catch {
    // The library messages carry field keys; the registrant gets one fixed code.
    throw new RegistrantInputError();
  }
}

/** The optional fixed profile fields of the form. */
export type RegistrantProfileFields = { company?: string; department?: string };

/** Read `company` and `department` from the body, but only those the event asks for
 * (`ask_company`, `ask_department`). A disabled field is not read at all, so a value posted for it
 * is ignored without an error. An empty answer is left out; a hostile one is refused. */
export function pickRegistrantProfileFields(
  ask: { company: boolean; department: boolean },
  body: unknown,
): RegistrantProfileFields {
  if (!isPlainRecord(body)) throw new RegistrantInputError();
  const out: RegistrantProfileFields = {};
  const company = ask.company ? optionalProfileText(ownValue(body, "company")) : undefined;
  if (company) out.company = company;
  const department = ask.department ? optionalProfileText(ownValue(body, "department")) : undefined;
  if (department) out.department = department;
  return out;
}

function optionalProfileText(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const clean = normalizeRegistrantText(raw, REGISTRANT_TEXT_MAX);
  if (clean === null) throw new RegistrantInputError();
  return clean || undefined;
}
