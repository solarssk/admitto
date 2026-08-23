/**
 * @admitto/auth/webauthn-testing — WebAuthn virtual-authenticator helper for unit/integration
 * tests only. Do not import from application code.
 */
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { isoBase64URL, isoCBOR, cose } from "@simplewebauthn/server/helpers";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";

/**
 * A minimal, spec-correct "none"-attestation FIDO2 authenticator for tests. No real hardware or
 * browser needed: it generates a genuine P-256 keypair and produces real CBOR/ASN.1-encoded
 * responses that @simplewebauthn/server's verify functions accept, exactly like a browser +
 * authenticator would over `navigator.credentials.create()`/`.get()`.
 */
export interface VirtualAuthenticator {
  register(params: { challenge: string; rpID: string; origin: string }): RegistrationResponseJSON;
  authenticate(params: { challenge: string; rpID: string; origin: string }): AuthenticationResponseJSON;
  /** Registration response with a real, well-formed "packed" self-attestation (no x5c) whose
   * signature was computed over the wrong data — exercises `verifyRegistrationResponse`
   * resolving with `{ verified: false }` (a real, non-throwing rejection distinct from the
   * malformed/mismatched-input cases that throw instead). */
  registerWithInvalidAttestationSignature(params: {
    challenge: string;
    rpID: string;
    origin: string;
  }): RegistrationResponseJSON;
}

/** Derived from the encoder's own signature rather than importing tiny-cbor's `CBORType`
 * directly — that package is only ever a transitive dependency of `@simplewebauthn/server`. */
type CBORValue = Parameters<typeof isoCBOR.encode>[0];

// `Uint8Array<ArrayBuffer>`, not the bare `Uint8Array` (= `Uint8Array<ArrayBufferLike>`) alias -
// @simplewebauthn/server's helpers require the narrower type, which only a fresh `new
// Uint8Array(n)`-backed buffer satisfies (a bare annotation here would widen it right back).
function concatBytes(arrays: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function uint16BE(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, false);
  return out;
}

function uint32BE(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

export function createVirtualAuthenticator(): VirtualAuthenticator {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const x = isoBase64URL.toBuffer(jwk.x);
  const y = isoBase64URL.toBuffer(jwk.y);
  const credentialId = new Uint8Array(randomBytes(32));
  let counter = 0;

  const cosePublicKey = new Map<number, CBORValue>([
    [cose.COSEKEYS.kty, cose.COSEKTY.EC2],
    [cose.COSEKEYS.alg, cose.COSEALG.ES256],
    [cose.COSEKEYS.crv, cose.COSECRV.P256],
    [cose.COSEKEYS.x, x],
    [cose.COSEKEYS.y, y],
  ]);

  function clientDataJSON(
    type: "webauthn.create" | "webauthn.get",
    challenge: string,
    origin: string,
  ): Uint8Array<ArrayBuffer> {
    const json = JSON.stringify({ type, challenge, origin, crossOrigin: false });
    return new Uint8Array(new TextEncoder().encode(json));
  }

  /** rpIdHash(32) + flags(1) + signCount(4) [+ attestedCredentialData for registration]. */
  function authenticatorData(
    rpID: string,
    attestedCredentialData?: Uint8Array<ArrayBuffer>,
  ): Uint8Array<ArrayBuffer> {
    const rpIdHash = new Uint8Array(createHash("sha256").update(rpID).digest());
    const flags = attestedCredentialData ? 0x45 : 0x05; // UP(0x01) + UV(0x04) [+ AT(0x40)]
    counter += 1;
    const parts = [rpIdHash, new Uint8Array([flags]), uint32BE(counter)];
    if (attestedCredentialData) parts.push(attestedCredentialData);
    return concatBytes(parts);
  }

  return {
    register({ challenge, rpID, origin }) {
      const aaguid = new Uint8Array(16);
      const attestedCredentialData = concatBytes([
        aaguid,
        uint16BE(credentialId.length),
        credentialId,
        isoCBOR.encode(cosePublicKey),
      ]);
      const authData = authenticatorData(rpID, attestedCredentialData);
      const attestationObject = isoCBOR.encode(
        new Map<string, CBORValue>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData],
        ]),
      );
      const idB64 = isoBase64URL.fromBuffer(credentialId);
      return {
        id: idB64,
        rawId: idB64,
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON("webauthn.create", challenge, origin)),
          attestationObject: isoBase64URL.fromBuffer(attestationObject),
        },
        clientExtensionResults: {},
        type: "public-key",
      };
    },
    registerWithInvalidAttestationSignature({ challenge, rpID, origin }) {
      const aaguid = new Uint8Array(16);
      const attestedCredentialData = concatBytes([
        aaguid,
        uint16BE(credentialId.length),
        credentialId,
        isoCBOR.encode(cosePublicKey),
      ]);
      const authData = authenticatorData(rpID, attestedCredentialData);
      const cdj = clientDataJSON("webauthn.create", challenge, origin);
      const clientDataHash = new Uint8Array(createHash("sha256").update(cdj).digest());
      // Real ECDSA signature (from this authenticator's own key, so it's structurally valid),
      // but computed over the client data hash alone instead of `authData + clientDataHash` -
      // fails @simplewebauthn's signature check without throwing, unlike every other rejection
      // path in this file's other tests.
      const badSignature = createSign("sha256").update(clientDataHash).sign(privateKey);
      const attStmt = new Map<string, CBORValue>([
        ["sig", new Uint8Array(badSignature)],
        ["alg", cose.COSEALG.ES256],
      ]);
      const attestationObject = isoCBOR.encode(
        new Map<string, CBORValue>([
          ["fmt", "packed"],
          ["attStmt", attStmt],
          ["authData", authData],
        ]),
      );
      const idB64 = isoBase64URL.fromBuffer(credentialId);
      return {
        id: idB64,
        rawId: idB64,
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(cdj),
          attestationObject: isoBase64URL.fromBuffer(attestationObject),
        },
        clientExtensionResults: {},
        type: "public-key",
      };
    },
    authenticate({ challenge, rpID, origin }) {
      const authData = authenticatorData(rpID);
      const cdj = clientDataJSON("webauthn.get", challenge, origin);
      const clientDataHash = new Uint8Array(createHash("sha256").update(cdj).digest());
      const signature = createSign("sha256").update(concatBytes([authData, clientDataHash])).sign(privateKey);
      const idB64 = isoBase64URL.fromBuffer(credentialId);
      return {
        id: idB64,
        rawId: idB64,
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(cdj),
          authenticatorData: isoBase64URL.fromBuffer(authData),
          signature: isoBase64URL.fromBuffer(new Uint8Array(signature)),
        },
        clientExtensionResults: {},
        type: "public-key",
      };
    },
  };
}
