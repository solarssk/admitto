/**
 * The event's own address for guests (D-C6): what a superadmin may enter, and the one place that says what an address of that kind
 * is. The server refuses a save by it, and the panel will tell the person before they send it (PR 120), so the two cannot drift apart.
 *
 * A custom address is a bare host name: no scheme, port, path, query, user information or space, no IP address, no trailing dot, at
 * least one dot, at most 253 characters in all and 63 in a label. It is stored as the browser and the DNS see it: lower case, with a
 * name outside ASCII turned into punycode (`xn--...`). The conversion is the one of the WHATWG `URL` parser, which every browser and
 * Node have, so this file needs no Node module and can be used in the panel; the characters it is given are checked first, so
 * nothing of a path or an authority can reach the parser.
 *
 * This is the shape only. Whether a host is the instance's own, or already another event's, is for the server (it needs the
 * instance address and the table).
 */

/** The longest name in DNS, in its ASCII form. */
export const CUSTOM_DOMAIN_MAX = 253;

/** What the last check of an address found. `unchecked` until it is checked (PR 120 writes the other two). */
export const CUSTOM_DOMAIN_STATUSES = ["unchecked", "ok", "failing"] as const;
export type CustomDomainStatus = (typeof CUSTOM_DOMAIN_STATUSES)[number];

/**
 * Why a value is not an address of that kind:
 * - `empty`: nothing;
 * - `too_long`: more than 253 characters;
 * - `bad_characters`: anything but letters, digits, dots and hyphens (a scheme, a port, a path, a query, `user@`, a space, brackets);
 * - `trailing_dot`: ends with a dot;
 * - `ip_address`: an IP address (or a name that ends in a number, which a browser reads as one);
 * - `reserved`: `localhost`, `*.localhost`, `*.local` or `*.internal`, which no organisation's guests can reach;
 * - `no_dot`: a single label;
 * - `bad_label`: an empty label, one longer than 63 characters, one that starts or ends with a hyphen, or a top-level label that
 *   does not start with a letter.
 */
export type CustomDomainProblem =
  | "empty"
  | "too_long"
  | "bad_characters"
  | "trailing_dot"
  | "ip_address"
  | "reserved"
  | "no_dot"
  | "bad_label";

export type CustomDomainParse = { ok: true; domain: string } | { ok: false; problem: CustomDomainProblem };

/** Letters, digits and marks of any script (an internationalised name), dots and hyphens: nothing that is syntax in an address. */
const RAW_CHARACTERS = /^[\p{L}\p{N}\p{M}.-]+$/u;
/** The digits and dots of an IPv4 address in any of its short forms. */
const IPV4_LIKE = /^[0-9.]+$/;
const LABEL_CHARACTERS = /^[a-z0-9-]+$/;
const LABEL_MAX = 63;
const STARTS_WITH_LETTER = /^[a-z]/;
const ALL_DIGITS = /^[0-9]+$/;
/** Top-level labels that are never a public name. */
const RESERVED_TOP_LABELS: ReadonlySet<string> = new Set(["localhost", "local", "internal"]);

/** A label in its ASCII form: 1 to 63 letters, digits and hyphens, not starting or ending with a hyphen. */
function isLabel(label: string): boolean {
  return label.length <= LABEL_MAX && LABEL_CHARACTERS.test(label) && !label.startsWith("-") && !label.endsWith("-");
}

/** The ASCII, lower-case form of `raw` as a URL parser reads a host, or null when it does not read as one. */
function asciiHost(raw: string): string | null {
  try {
    return new URL(`http://${raw}`).hostname;
  } catch {
    return null;
  }
}

/** What is wrong with the labels of an ASCII host name, or null. */
function labelsProblem(host: string): CustomDomainProblem | null {
  if (host.length > CUSTOM_DOMAIN_MAX) return "too_long";
  const labels = host.split(".");
  const top = labels.at(-1) ?? "";
  if (RESERVED_TOP_LABELS.has(top)) return "reserved";
  if (labels.length < 2) return "no_dot";
  if (!labels.every((label) => isLabel(label))) return "bad_label";
  if (STARTS_WITH_LETTER.test(top)) return null;
  // A host whose last label is a number is an IP address to a browser (`1.2.3.4`, `0x7f.1`), and no top-level name starts with a digit.
  return ALL_DIGITS.test(top) ? "ip_address" : "bad_label";
}

/** Whether `raw` is an address of that kind, and the form it is stored in (lower case, punycode) when it is. Nothing is trimmed. */
export function parseCustomDomain(raw: string): CustomDomainParse {
  if (raw === "") return { ok: false, problem: "empty" };
  if (raw.length > CUSTOM_DOMAIN_MAX) return { ok: false, problem: "too_long" };
  if (!RAW_CHARACTERS.test(raw)) return { ok: false, problem: "bad_characters" };
  if (raw.endsWith(".")) return { ok: false, problem: "trailing_dot" };
  if (IPV4_LIKE.test(raw)) return { ok: false, problem: "ip_address" };
  const host = asciiHost(raw);
  if (host === null) return { ok: false, problem: "bad_label" };
  const problem = labelsProblem(host);
  return problem === null ? { ok: true, domain: host } : { ok: false, problem };
}
