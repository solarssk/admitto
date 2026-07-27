import argon2 from "argon2";

const ARGON2_OPTIONS: argon2.HashOptions & { type: typeof argon2.argon2id } = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/** Hash a plaintext password with argon2id. Never log the input. */
export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

/** Verify plaintext against an argon2id hash. */
export async function verifyPassword(plaintext: string, passwordHash: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, plaintext);
  } catch {
    return false;
  }
}

/**
 * Dummy verify for timing mitigation when user does not exist.
 * Lazily initialized valid argon2id hash so verification takes comparable time.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("__admitto_dummy_timing__");
  return dummyHashPromise;
}

/**
 * Verify password; when hash is null (unknown user), run dummy argon2 for timing parity.
 */
export async function verifyPasswordOrDummy(
  plaintext: string,
  passwordHash: string | null,
): Promise<boolean> {
  if (passwordHash) {
    return verifyPassword(plaintext, passwordHash);
  }
  const dummy = await getDummyHash();
  await verifyPassword(plaintext, dummy);
  return false;
}
