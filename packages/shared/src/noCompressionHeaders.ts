/**
 * Spread into any outbound fetch's `headers` when calling the bare global `fetch` directly
 * (not via `withPinnedFetch`/`safeOidcFetch`) to a third party. Works around a reproduced Node
 * process bug: importing the npm `undici` package for any reason (e.g. `@admitto/auth`'s OIDC
 * fetch wrapper, or this package's own pinnedDispatcher.ts) silently swaps Node's *global*
 * `fetch`'s dispatcher for one created by the npm package's own module instance. Over a real
 * HTTP/2 connection this corrupts the response: status is still 200, but `Headers` comes back
 * empty and the body arrives as raw, still-compressed bytes instead of being transparently
 * decompressed. HTTP/1.1 is unaffected. Asking the server for `identity` (no compression) means
 * the corrupted decompression path is never entered, sidestepping the bug regardless of cause.
 *
 * Code already routed through `withPinnedFetch`/`safeOidcFetch` never consults the corrupted
 * global dispatcher (it always passes its own explicit one) and does not need this.
 */
export const NO_COMPRESSION_HEADERS = { "Accept-Encoding": "identity" } as const;
