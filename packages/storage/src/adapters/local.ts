import { randomUUID } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { StoragePathError } from "../errors.js";
import type { StorageAdapter, StoragePutOptions } from "../types.js";

const ORG_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const EVENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const EXT_PATTERN = /^\.[a-z0-9]{1,8}$/;

/** Resolve local branding upload directory from `UPLOAD_DIR` or `./uploads`. */
export function resolveUploadDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.UPLOAD_DIR ?? join(process.cwd(), "uploads");
}

/**
 * Resolve `relativePath` (storage key) under the upload root; rejects escape attempts.
 * Exported for unit tests; production callers should use {@link LocalStorageAdapter} only.
 */
export function absolutePathUnderUploadRoot(
  relativePath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  // resolve() never keeps a trailing separator (except filesystem root), so prefer root+sep.
  const root = resolve(resolveUploadDir(env));
  const abs = resolve(join(root, relativePath));
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new StoragePathError();
  }
  return abs;
}

function assertSafeOrgId(orgId: string): void {
  if (!ORG_ID_PATTERN.test(orgId)) {
    throw new StoragePathError("invalid_org_id");
  }
}

function assertSafeEventId(eventId: string): void {
  if (!EVENT_ID_PATTERN.test(eventId)) {
    throw new StoragePathError("invalid_event_id");
  }
}

function buildKey(opts: StoragePutOptions): string {
  assertSafeOrgId(opts.orgId);
  if (!EXT_PATTERN.test(opts.ext)) {
    throw new StoragePathError("invalid_ext");
  }
  const filename = `${randomUUID()}${opts.ext}`;
  if (opts.scope === "org") {
    return `${opts.orgId}/${filename}`;
  }
  if (opts.scope === "theme") {
    return `${opts.orgId}/theme/${filename}`;
  }
  if (!opts.eventId) {
    throw new StoragePathError("missing_event_id");
  }
  assertSafeEventId(opts.eventId);
  return `${opts.orgId}/events/${opts.eventId}/${filename}`;
}

/** Filesystem StorageAdapter bound to `UPLOAD_DIR` (re-read on every call). */
export class LocalStorageAdapter implements StorageAdapter {
  readonly provider = "local" as const;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async put(bytes: Buffer, opts: StoragePutOptions): Promise<{ url: string; key: string }> {
    const key = buildKey(opts);
    const abs = absolutePathUnderUploadRoot(key, this.env);
    const dir = join(abs, "..");
    // Path confined by buildKey + resolve-under-root check above.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await mkdir(dir, { recursive: true });
    // Same trusted join as mkdir above.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(abs, bytes);
    return { url: `/uploads/${key}`, key };
  }

  async delete(key: string): Promise<{ deleted: boolean }> {
    const abs = absolutePathUnderUploadRoot(key, this.env);
    try {
      // Path confined by absolutePathUnderUploadRoot.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await unlink(abs);
      return { deleted: true };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { deleted: false };
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const abs = absolutePathUnderUploadRoot(key, this.env);
    try {
      // Path confined by absolutePathUnderUploadRoot.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await stat(abs);
      return true;
    } catch {
      return false;
    }
  }
}
