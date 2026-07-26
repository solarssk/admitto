import fs from "node:fs";

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Parse a single .env value, stripping quotes and unquoted inline comments. */
export function parseEnvValue(raw: string): string {
  let v = raw.trim();
  const quoted =
    (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"));
  if (quoted) {
    return v.slice(1, -1);
  }
  // Only treat ` #` as inline comment start (values may contain `#` without a space).
  const inlineComment = v.indexOf(" #");
  if (inlineComment !== -1) {
    v = v.slice(0, inlineComment).trim();
  }
  return v;
}

/** Load vars from one .env file into process.env (existing keys are not overwritten). */
export function loadEnvFile(envPath: string): void {
  // Callers construct this from local checkout/package paths; it is exported for CLI reuse and tests.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted local CLI/config path
  if (!fs.existsSync(envPath)) return;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted local CLI/config path
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (!ENV_KEY_RE.test(k)) continue;
    const v = parseEnvValue(t.slice(eq + 1));
    if (!Object.hasOwn(process.env, k)) Reflect.set(process.env, k, v);
  }
}
