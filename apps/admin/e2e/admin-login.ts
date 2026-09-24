import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";

/**
 * Signs the seeded superadmin in over the API on the page's own cookie jar, walking the forced
 * TOTP enrollment (login -> totp/enroll -> totp/confirm -> backup-codes/complete). Admin roles
 * must have MFA, and the enrollment secret only exists in the enroll response, so the code is
 * computed here instead of driving the QR screen. Afterwards `page.goto("/admin/...")` is signed in.
 */

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of input.split("=")[0]!.toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32 secret");
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(
  secret: string,
  digits: number,
  period: number,
  algorithm: string,
): string {
  const counter = Math.floor(Date.now() / 1000 / period);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(algorithm, base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

export async function signInAsAdmin(
  page: Page,
  baseUrl: string,
  email: string,
  password: string,
): Promise<void> {
  const origin = new URL(baseUrl).origin;
  const post = async (path: string, data?: Record<string, unknown>) => {
    const res = await page.request.post(path, {
      headers: { Origin: origin },
      data,
    });
    if (!res.ok())
      throw new Error(`POST ${path} -> ${res.status()} ${await res.text()}`);
    return (await res.json()) as Record<string, unknown>;
  };

  let step = await post("/api/auth/login", { email, password });
  if (step["next"] === "enrollment_required") {
    const enrolled = await post("/api/auth/mfa/totp/enroll");
    const uri = new URL(String(enrolled["otpauth_uri"]));
    const secret = uri.searchParams.get("secret");
    if (!secret) throw new Error("enroll response had no TOTP secret");
    const code = totp(
      secret,
      Number(uri.searchParams.get("digits") ?? 6),
      Number(uri.searchParams.get("period") ?? 30),
      (uri.searchParams.get("algorithm") ?? "SHA1").toLowerCase(),
    );
    step = await post("/api/auth/mfa/totp/confirm", { code });
  }
  if (step["next"] === "backup_codes_required") {
    step = await post("/api/auth/mfa/totp/backup-codes/complete");
  }
  if (step["next"] !== "complete") {
    throw new Error(
      `admin login did not reach a full session (next=${String(step["next"])})`,
    );
  }
}
