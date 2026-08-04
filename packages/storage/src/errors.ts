/** Thrown when a storage key would escape the configured upload root. */
export class StoragePathError extends Error {
  constructor(message = "invalid_storage_key") {
    super(message);
    this.name = "StoragePathError";
  }
}
