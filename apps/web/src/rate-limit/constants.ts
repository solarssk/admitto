/** Sliding/fixed window length for public /t and /q rate limiting (ms). */
export const WINDOW_MS = 60_000;

/**
 * Maximum requests per IP allowed within {@link WINDOW_MS}.
 *
 * Kept well above ordinary per-visitor traffic so that many genuinely distinct attendees who
 * happen to share one apparent public IP - most commonly several people behind the same
 * corporate NAT, or unrelated mobile users behind a carrier's large-scale NAT (CGNAT), which is
 * common in some regions and can put hundreds of distinct subscribers behind one address at
 * once - don't collide into false-positive 429s on their own ticket page. This is deliberately
 * generous for that reason; it is not meant to be a tight anti-scraping bound.
 */
export const MAX_REQUESTS = 500;

/** Cap on distinct client keys tracked by the in-memory store before eviction. */
export const MAX_BUCKETS = 10_000;
