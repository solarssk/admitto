#!/usr/bin/env node
/**
 * Signs in to a running Admitto stack as a synthetic superadmin over HTTP, walking the forced TOTP
 * enrollment (login -> enroll -> confirm -> backup-codes complete), and prints the resulting
 * full-session cookie as `name=value` on stdout. Used by .github/workflows/dast-baseline.yml so
 * OWASP ZAP can scan /admin as a signed-in user.
 *
 * Only ever pointed at the disposable compose stack that workflow builds; the account and its
 * TOTP secret exist for the length of that run.
 *
 * Usage: BASE_URL=http://127.0.0.1:8080 DAST_EMAIL=... DAST_PASSWORD=... node scripts/dast-login.mjs
 */
import { createHmac } from "node:crypto";

const BASE_URL = process.env.BASE_URL;
const EMAIL = process.env.DAST_EMAIL;
const PASSWORD = process.env.DAST_PASSWORD;
if (!BASE_URL || !EMAIL || !PASSWORD) {
  console.error("BASE_URL, DAST_EMAIL and DAST_PASSWORD are required");
  process.exit(2);
}

const origin = new URL(BASE_URL).origin;
let cookieJar = new Map();

function absorbCookies(res) {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === "" || /;\s*max-age=0/i.test(raw)) cookieJar.delete(name);
    else cookieJar.set(name, value);
  }
}

function cookieHeader() {
  return [...cookieJar].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookieHeader(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  absorbCookies(res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    throw new Error(`POST ${path} -> ${res.status} ${text.slice(0, 200)}`);
  }
  return json ?? {};
}

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of input.split("=")[0].toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32 secret");
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(
  secretBase32,
  digits = 6,
  periodSeconds = 30,
  algorithm = "sha1",
) {
  const counter = Math.floor(Date.now() / 1000 / periodSeconds);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(algorithm, base32Decode(secretBase32))
    .update(buf)
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

let step = await post("/api/auth/login", { email: EMAIL, password: PASSWORD });

if (step.next === "enrollment_required") {
  const enrolled = await post("/api/auth/mfa/totp/enroll");
  const uri = new URL(enrolled.otpauth_uri);
  const secret = uri.searchParams.get("secret");
  if (!secret) throw new Error("enroll response had no TOTP secret");
  const digits = Number(uri.searchParams.get("digits") ?? 6);
  const period = Number(uri.searchParams.get("period") ?? 30);
  const algorithm = (uri.searchParams.get("algorithm") ?? "SHA1").toLowerCase();
  step = await post("/api/auth/mfa/totp/confirm", {
    code: totp(secret, digits, period, algorithm),
  });
}

if (step.next === "backup_codes_required") {
  step = await post("/api/auth/mfa/totp/backup-codes/complete");
}

if (step.next !== "complete") {
  throw new Error(`login did not reach a full session (next=${step.next})`);
}

const session = [...cookieJar].find(([name]) => /session/i.test(name));
if (!session) throw new Error("no session cookie after login");
process.stdout.write(`${session[0]}=${session[1]}\n`);
