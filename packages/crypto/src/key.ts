let _key: Buffer | null | undefined = undefined;

export function getEncryptionKey(): Buffer {
  if (_key === undefined) {
    const raw = process.env["ENCRYPTION_KEY"];
    if (!raw) {
      _key = null;
    } else {
      const buf = Buffer.from(raw, "base64");
      if (buf.length !== 32) {
        throw new Error("ENCRYPTION_KEY must be 32 bytes (base64-encoded, 44 characters)");
      }
      _key = buf;
    }
  }
  if (_key === null) {
    const isDev =
      process.env["NODE_ENV"] === "development" || process.env["NODE_ENV"] === "test";
    throw new Error(
      isDev
        ? "ENCRYPTION_KEY is not set. Add it to your .env file: openssl rand -base64 32"
        : "ENCRYPTION_KEY is required",
    );
  }
  return _key;
}

// Reset cached key — only for use in tests.
export function _resetKeyCache(): void {
  _key = undefined;
}
