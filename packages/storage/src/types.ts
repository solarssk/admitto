/** Branding upload scope under `/uploads/{orgId}/…`. */
export type StorageScope = "org" | "event" | "theme";

/** Options for writing a new object; adapter generates the UUID filename. */
export type StoragePutOptions = {
  readonly orgId: string;
  readonly eventId?: string;
  readonly scope: StorageScope;
  /** Extension including the leading dot (e.g. `.png`, `.woff2`). */
  readonly ext: string;
};

/**
 * Backend for branding binary blobs (logos, headers, theme fonts).
 * `key` is the path under the upload root (same as `parseUploadsUrl().relativePath`).
 */
export interface StorageAdapter {
  readonly provider: "local" | "s3";
  put(bytes: Buffer, opts: StoragePutOptions): Promise<{ url: string; key: string }>;
  /** Missing key is success (`deleted: false`); path escape throws. Never throws on ENOENT. */
  delete(key: string): Promise<{ deleted: boolean }>;
  exists(key: string): Promise<boolean>;
}
