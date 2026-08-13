import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { Prisma } from "@admitto/db";
import {
  applyWebhookUpdate,
  parseAdmittoUserProvidedId,
  parseWebhookData,
  parseWebhookEnvelope,
  verifyWebhookSignature,
} from "../src/passcreator-webhook.js";

function recordNotFoundError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Record to update not found", {
    code: "P2025",
    clientVersion: "test",
  });
}

function signP256(data: string, privateKeyPem: string): string {
  const signer = createSign("SHA256");
  signer.update(data, "utf8");
  signer.end();
  return signer.sign(privateKeyPem, "hex");
}

describe("verifyWebhookSignature", () => {
  it("accepts a genuine ECDSA P-256/SHA-256 signature over the exact string bytes", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const data = '{"identifier":"pass-1","voided":false}';
    const signature = signP256(data, privateKey);
    expect(verifyWebhookSignature(data, signature, publicKey)).toBe(true);
  });

  it("rejects a signature that doesn't match the data", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const signature = signP256('{"identifier":"pass-1"}', privateKey);
    expect(verifyWebhookSignature('{"identifier":"pass-2"}', signature, publicKey)).toBe(false);
  });

  it("rejects a signature made with a different key pair", () => {
    const pairA = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const pairB = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const data = '{"identifier":"pass-1"}';
    const signature = signP256(data, pairA.privateKey);
    expect(verifyWebhookSignature(data, signature, pairB.publicKey)).toBe(false);
  });

  it("returns false (not throw) for a malformed hex signature", () => {
    const { publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    expect(verifyWebhookSignature("{}", "not-hex-zzz", publicKey)).toBe(false);
  });

  it("returns false (not throw) for a malformed public key", () => {
    expect(verifyWebhookSignature("{}", "aabbcc", "not a pem key")).toBe(false);
  });
});

describe("parseWebhookEnvelope", () => {
  it("accepts {signedData, signature} as strings", () => {
    const result = parseWebhookEnvelope({ signedData: "{}", signature: "abcd" });
    expect(result).toEqual({ signedData: "{}", signature: "abcd" });
  });

  it("rejects a body missing either field", () => {
    expect(parseWebhookEnvelope({ signedData: "{}" })).toBeNull();
    expect(parseWebhookEnvelope({ signature: "abcd" })).toBeNull();
  });

  it("rejects non-string fields, empty strings, and non-object bodies", () => {
    expect(parseWebhookEnvelope({ signedData: 1, signature: "abcd" })).toBeNull();
    expect(parseWebhookEnvelope({ signedData: "", signature: "abcd" })).toBeNull();
    expect(parseWebhookEnvelope(null)).toBeNull();
    expect(parseWebhookEnvelope("just a string")).toBeNull();
    expect(parseWebhookEnvelope(undefined)).toBeNull();
  });
});

describe("parseWebhookData", () => {
  it("extracts known fields, ignoring unknown ones", () => {
    const data = parseWebhookData(
      JSON.stringify({
        identifier: "pass-1",
        userProvidedId: "admitto:evt-1:att-1",
        voided: false,
        operatingSystem: "iOS",
        noOfActivePasses: 1,
        noOfInactivePasses: 0,
        firstDownloadedAt: "2026-08-13 10:00:00",
        somethingUnrecognized: "ignored",
      }),
    );
    expect(data).toEqual({
      identifier: "pass-1",
      userProvidedId: "admitto:evt-1:att-1",
      voided: false,
      operatingSystem: "iOS",
      noOfActivePasses: 1,
      noOfInactivePasses: 0,
      firstDownloadedAt: "2026-08-13 10:00:00",
    });
  });

  it("extracts the exact field set confirmed on a live pushnotification_unregistered delivery (2026-08-13)", () => {
    // Trimmed to the fields parseWebhookData actually reads - the real payload also carries
    // buyer*/device*/passTemplateGuid/genericProperties/etc. that we deliberately ignore, plus a
    // recursively self-nested signedData/signature pair that's presumably a PassCreator delivery-
    // log rendering artifact, not part of what's parsed here.
    const data = parseWebhookData(
      JSON.stringify({
        uniqueIdentifier: "apdvqjfes1bgoc71136a7dd12769122",
        operatingSystem: "iOS",
        passTemplate: "Cybersecurity Awareness Month 2026",
        userProvidedId: "admitto:evt-1:att-1",
        noOfActivePasses: 0,
        noOfInactivePasses: 2,
        identifier: "753135e7-5558-48a9-b955-33c09cc1ae37",
        deviceOperatingSystem: "",
      }),
    );
    expect(data).toEqual({
      operatingSystem: "iOS",
      userProvidedId: "admitto:evt-1:att-1",
      noOfActivePasses: 0,
      noOfInactivePasses: 2,
      identifier: "753135e7-5558-48a9-b955-33c09cc1ae37",
    });
  });

  it("returns an empty object (not null) for valid JSON with none of the known fields", () => {
    expect(parseWebhookData(JSON.stringify({ foo: "bar" }))).toEqual({});
  });

  it("returns null for invalid JSON or a non-object", () => {
    expect(parseWebhookData("not json")).toBeNull();
    expect(parseWebhookData("42")).toBeNull();
    expect(parseWebhookData("null")).toBeNull();
  });

  it("keeps firstDownloadedAt: null distinct from it being absent", () => {
    const withNull = parseWebhookData(JSON.stringify({ firstDownloadedAt: null }));
    expect(withNull).toEqual({ firstDownloadedAt: null });
    const withoutField = parseWebhookData(JSON.stringify({}));
    expect(withoutField).toEqual({});
  });
});

describe("parseAdmittoUserProvidedId", () => {
  it("parses our own admitto:{eventId}:{attendeeId} scheme", () => {
    expect(parseAdmittoUserProvidedId("admitto:evt-1:att-1")).toEqual({
      eventId: "evt-1",
      attendeeId: "att-1",
    });
  });

  it("returns null for a non-admitto id (e.g. an agency payload)", () => {
    expect(parseAdmittoUserProvidedId("some-agency-ref-123")).toBeNull();
  });

  it("returns null for a malformed admitto id (wrong segment count)", () => {
    expect(parseAdmittoUserProvidedId("admitto:evt-1")).toBeNull();
    expect(parseAdmittoUserProvidedId("admitto:evt-1:att-1:extra")).toBeNull();
  });
});

describe("applyWebhookUpdate", () => {
  function makeDb() {
    return { walletPass: { update: vi.fn() } };
  }

  it("matches by user_provided_id when present, sets registration_checked_at and provided fields", async () => {
    const db = makeDb();
    db.walletPass.update.mockResolvedValueOnce({});
    const result = await applyWebhookUpdate(db as never, {
      userProvidedId: "admitto:evt-1:att-1",
      operatingSystem: "AndroidGooglePay",
      noOfActivePasses: 1,
      noOfInactivePasses: 0,
    });
    expect(result).toEqual({ matched: true });
    expect(db.walletPass.update).toHaveBeenCalledWith({
      where: { provider_user_provided_id: { provider: "passcreator", user_provided_id: "admitto:evt-1:att-1" } },
      data: expect.objectContaining({
        google_active_registrations: 1,
        google_inactive_registrations: 0,
        registration_checked_at: expect.any(Date),
      }),
    });
  });

  it("maps operatingSystem: iOS to the apple_* columns (confirmed live 2026-08-13)", async () => {
    const db = makeDb();
    db.walletPass.update.mockResolvedValueOnce({});
    await applyWebhookUpdate(db as never, {
      identifier: "pc-1",
      operatingSystem: "iOS",
      noOfActivePasses: 0,
      noOfInactivePasses: 2,
    });
    expect(db.walletPass.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ apple_active_registrations: 0, apple_inactive_registrations: 2 }),
      }),
    );
    const call = db.walletPass.update.mock.calls[0]?.[0];
    expect(call.data).not.toHaveProperty("google_active_registrations");
    expect(call.data).not.toHaveProperty("google_inactive_registrations");
  });

  it("maps operatingSystem: AndroidGooglePay to the google_* columns (confirmed live 2026-08-13)", async () => {
    const db = makeDb();
    db.walletPass.update.mockResolvedValueOnce({});
    await applyWebhookUpdate(db as never, {
      identifier: "pc-2",
      operatingSystem: "AndroidGooglePay",
      noOfActivePasses: 1,
      noOfInactivePasses: 0,
    });
    expect(db.walletPass.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ google_active_registrations: 1, google_inactive_registrations: 0 }),
      }),
    );
    const call = db.walletPass.update.mock.calls[0]?.[0];
    expect(call.data).not.toHaveProperty("apple_active_registrations");
    expect(call.data).not.toHaveProperty("apple_inactive_registrations");
  });

  it("leaves both apple_* and google_* columns untouched when operatingSystem is a bare 'Android' - PassCreator's real value is 'AndroidGooglePay'", async () => {
    const db = makeDb();
    db.walletPass.update.mockResolvedValueOnce({});
    await applyWebhookUpdate(db as never, { identifier: "pc-1", operatingSystem: "Android", noOfActivePasses: 1 });
    const call = db.walletPass.update.mock.calls[0]?.[0];
    expect(call.data).not.toHaveProperty("apple_active_registrations");
    expect(call.data).not.toHaveProperty("google_active_registrations");
  });

  it("leaves both apple_* and google_* columns untouched when operatingSystem is absent - can't tell which platform the counts belong to", async () => {
    const db = makeDb();
    db.walletPass.update.mockResolvedValueOnce({});
    await applyWebhookUpdate(db as never, { identifier: "pc-1", noOfActivePasses: 1, noOfInactivePasses: 0 });
    const call = db.walletPass.update.mock.calls[0]?.[0];
    expect(call.data).not.toHaveProperty("apple_active_registrations");
    expect(call.data).not.toHaveProperty("google_active_registrations");
  });

  it.each(["iPadOS", "macOS"])(
    "maps operatingSystem: %s to the apple_* columns - Wallet runs on all Apple platforms, not just iOS",
    async (operatingSystem) => {
      const db = makeDb();
      db.walletPass.update.mockResolvedValueOnce({});
      await applyWebhookUpdate(db as never, { identifier: "pc-1", operatingSystem, noOfActivePasses: 1 });
      const call = db.walletPass.update.mock.calls[0]?.[0];
      expect(call.data).toMatchObject({ apple_active_registrations: 1 });
      expect(call.data).not.toHaveProperty("google_active_registrations");
    },
  );

  it("leaves both apple_* and google_* columns untouched when operatingSystem is an unrecognized value - never guess platform from a value we don't understand", async () => {
    const db = makeDb();
    db.walletPass.update.mockResolvedValueOnce({});
    await applyWebhookUpdate(db as never, {
      identifier: "pc-1",
      operatingSystem: "webOS",
      noOfActivePasses: 1,
      noOfInactivePasses: 0,
    });
    const call = db.walletPass.update.mock.calls[0]?.[0];
    expect(call.data).not.toHaveProperty("apple_active_registrations");
    expect(call.data).not.toHaveProperty("google_active_registrations");
    expect(call.data).not.toHaveProperty("apple_inactive_registrations");
    expect(call.data).not.toHaveProperty("google_inactive_registrations");
  });

  it("falls back to identifier (provider_pass_id) when userProvidedId is absent", async () => {
    const db = makeDb();
    db.walletPass.update.mockResolvedValueOnce({});
    await applyWebhookUpdate(db as never, { identifier: "pc-pass-1" });
    expect(db.walletPass.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider_provider_pass_id: { provider: "passcreator", provider_pass_id: "pc-pass-1" } },
      }),
    );
  });

  it("returns matched: false without calling update when neither identifier is present", async () => {
    const db = makeDb();
    const result = await applyWebhookUpdate(db as never, { voided: true });
    expect(result).toEqual({ matched: false });
    expect(db.walletPass.update).not.toHaveBeenCalled();
  });

  it("returns matched: false (not throw) when no WalletPass row matches (Prisma P2025)", async () => {
    const db = makeDb();
    db.walletPass.update.mockRejectedValueOnce(recordNotFoundError());
    const result = await applyWebhookUpdate(db as never, { identifier: "pc-gone" });
    expect(result).toEqual({ matched: false });
  });

  it("propagates a non-P2025 failure instead of silently reporting matched: false", async () => {
    const db = makeDb();
    db.walletPass.update.mockRejectedValueOnce(new Error("connection terminated unexpectedly"));
    await expect(applyWebhookUpdate(db as never, { identifier: "pc-1" })).rejects.toThrow(
      "connection terminated unexpectedly",
    );
  });

  it("sets status: voided and voided_at when voided: true", async () => {
    const db = makeDb();
    db.walletPass.update.mockResolvedValueOnce({});
    await applyWebhookUpdate(db as never, { identifier: "pc-1", voided: true });
    expect(db.walletPass.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "voided", voided_at: expect.any(Date) }),
      }),
    );
  });

  it("sets status: active and clears voided_at when voided: false", async () => {
    const db = makeDb();
    db.walletPass.update.mockResolvedValueOnce({});
    await applyWebhookUpdate(db as never, { identifier: "pc-1", voided: false });
    expect(db.walletPass.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "active", voided_at: null }) }),
    );
  });

  it("processing the same delivery twice is idempotent - same final field values either way", async () => {
    const db = makeDb();
    db.walletPass.update.mockResolvedValue({});
    const payload = { identifier: "pc-1", operatingSystem: "iOS", noOfActivePasses: 2 };
    await applyWebhookUpdate(db as never, payload);
    await applyWebhookUpdate(db as never, payload);
    expect(db.walletPass.update).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = db.walletPass.update.mock.calls;
    expect(firstCall?.[0].data.apple_active_registrations).toBe(2);
    expect(secondCall?.[0].data.apple_active_registrations).toBe(2);
  });
});
