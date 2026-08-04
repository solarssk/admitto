import { LocalStorageAdapter } from "./adapters/local.js";
import type { StorageAdapter } from "./types.js";

/**
 * Build a {@link StorageAdapter} from env.
 * `STORAGE_PROVIDER` defaults to `local`. `s3` is reserved (ADR 0038 Phase 3) and fails loudly.
 */
export function createStorage(env: NodeJS.ProcessEnv = process.env): StorageAdapter {
  const provider = (env.STORAGE_PROVIDER ?? "local").trim().toLowerCase();
  if (provider === "local" || provider === "") {
    return new LocalStorageAdapter(env);
  }
  if (provider === "s3") {
    throw new Error(
      'STORAGE_PROVIDER=s3 is not implemented yet (ADR 0038). Use STORAGE_PROVIDER=local or unset it.',
    );
  }
  throw new Error(
    `Unknown STORAGE_PROVIDER="${provider}". Supported: local (default). s3 is reserved for a later release.`,
  );
}

let defaultStorage: StorageAdapter | undefined;

/** Process-wide adapter (lazy). Reads `process.env` on first use. */
export function getDefaultStorage(): StorageAdapter {
  if (!defaultStorage) {
    defaultStorage = createStorage(process.env);
  }
  return defaultStorage;
}

/** Test helper: drop the cached singleton so the next call re-reads env. */
export function resetDefaultStorageForTests(): void {
  defaultStorage = undefined;
}
