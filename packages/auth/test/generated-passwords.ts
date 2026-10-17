/**
 * Stand-ins for the passwords a password manager makes: hex, digits, UUIDs and words. They come
 * from a fixed sequence, so a test run is repeatable and the repository holds no value that looks
 * like a secret.
 */
export const HEX = "0123456789abcdef";
export const DIGITS = "0123456789";
export const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** `length` characters of `alphabet`, chosen by a fixed pseudo-random sequence from `seed`. */
export function generatedText(alphabet: string, length: number, seed: number): string {
  let state = seed >>> 0;
  let text = "";
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    text += alphabet.charAt((state >>> 16) % alphabet.length);
  }
  return text;
}

function generatedUuid(seed: number): string {
  return [8, 4, 4, 4, 12].map((size, index) => generatedText(HEX, size, seed * 31 + index)).join("-");
}

/** Two UUIDs written one after the other: 72 characters. */
export function generatedUuidPair(seed: number): string {
  return generatedUuid(seed) + generatedUuid(seed + 1);
}

/** Fifteen different words with hyphens between them: 104 characters. */
export const GENERATED_PASSPHRASE = [
  "lantern",
  "orbit",
  "velvet",
  "harbor",
  "meadow",
  "copper",
  "falcon",
  "timber",
  "juniper",
  "quartz",
  "saddle",
  "willow",
  "amber",
  "pillar",
  "marble",
].join("-");

/**
 * A text of `length` characters that uses exactly `distinct` different characters, repeating them
 * in turn. The characters are taken in no alphabetical order, so the text is never a simple run.
 */
export function withDistinctCharacters(length: number, distinct: number): string {
  const pool = "xkqzvwjmphdbgtnr";
  let text = "";
  for (let i = 0; i < length; i++) text += pool.charAt(i % distinct);
  return text;
}
