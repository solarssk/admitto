/** Sliding/fixed window length for public /t and /q rate limiting (ms). */
export const WINDOW_MS = 60_000;

/** Maximum requests per IP allowed within {@link WINDOW_MS}. */
export const MAX_REQUESTS = 60;

/** Cap on distinct client keys tracked by the in-memory store before eviction. */
export const MAX_BUCKETS = 10_000;
