import type { MjmlRawError } from "./errors.js";

/** Every mjml-validator rule's own default message is `Attribute {attr} has invalid value:
 * {value} for type {Type}` - Unit/Enum types append extra detail after "for type X"; not
 * anchored to the end of the string (no trailing `$`) so that detail is simply never captured,
 * rather than matched by a second wildcard group - a lazy group directly followed by an
 * optional trailing wildcard is exactly the shape eslint-plugin-security's unsafe-regex check
 * flags, since a pathological input (many repeated commas) can make the two groups backtrack
 * against each other combinatorially. */
const INVALID_VALUE_RE = /^Attribute (\S+) has invalid value: (.+?) for type \w+/;
const UNKNOWN_TAG_RE = /^Element (\S+) doesn't exist or is not registered$/;
const ILLEGAL_ATTR_RE = /^Attributes? (.+?) (?:is|are) illegal$/;
const INVALID_NESTING_RE = /^(\S+) cannot be used inside (\S+), only inside: .+$/;
const MISSING_TITLE_RE = /^(?:Missing|Empty) mj-title\. Provide non-empty content for a valid <title>\.$/;

/**
 * Translates one raw mjml-validator error (see MjmlRawError) into a plain-English sentence an
 * operator without MJML knowledge can act on - never the raw compiler message, which uses
 * internal jargon (attribute/type/tag names verbatim) and, via formattedMessage, embeds the
 * server's own absolute file path (see compileTemplate's own filePath option for why that no
 * longer leaks a real path, but the raw message is still not something to show as-is).
 * Deliberately pattern-matches on `message` (not `formattedMessage`) so this never depends on
 * that path substitution being present.
 */
export function friendlyMjmlErrorMessage(error: MjmlRawError): string {
  const where = error.line != null ? ` (line ${error.line})` : "";
  const msg = error.message.trim();

  const invalidValue = INVALID_VALUE_RE.exec(msg);
  if (invalidValue) {
    const [, attribute, value] = invalidValue;
    return `The "${attribute}" setting has an invalid value ("${value}")${where}. Check it for typos.`;
  }

  const unknownTag = UNKNOWN_TAG_RE.exec(msg);
  if (unknownTag) {
    return `"${unknownTag[1]}" isn't a recognized MJML element${where}. Check the spelling.`;
  }

  const illegalAttr = ILLEGAL_ATTR_RE.exec(msg);
  if (illegalAttr) {
    return `"${illegalAttr[1]}" isn't a valid setting for this element${where}.`;
  }

  const invalidNesting = INVALID_NESTING_RE.exec(msg);
  if (invalidNesting) {
    const [, child, parent] = invalidNesting;
    return `"${child}" can't go directly inside "${parent}"${where}. Check where it's placed in the body.`;
  }

  if (MISSING_TITLE_RE.test(msg)) {
    return "The template is missing a title. Add an <mj-title> inside <mj-head>.";
  }

  const tagHint = error.tagName ? ` near <${error.tagName}>` : "";
  return `There's a formatting problem in the template body${tagHint}${where}. Check that area and try again.`;
}
