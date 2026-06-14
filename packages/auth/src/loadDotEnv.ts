import fs from "node:fs";

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
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = parseEnvValue(t.slice(eq + 1));
    if (!(k in process.env)) process.env[k] = v;
  }
}
