import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { logger } from "./logger.js";
import { resolveClientIp } from "./rate-limit/client-ip.js";

/**
 * Path prefixes whose remainder embeds ticket/QR tokens (`/t/:token`,
 * `/q/{token}.png`) — never log the raw path (SECURITY-CONTROLS: no secrets
 * in stdout).
 */
const TOKEN_PATH_PREFIXES = ["/t/", "/q/"] as const;

/**
 * Short, one-way identifier for the token-bearing remainder of a `/t/*`/`/q/*` path — lets
 * two log lines be recognized as "the same participant's link" without exposing the raw
 * ticket/QR token or the underlying secret's entropy. Same truncated-SHA-256 pattern as
 * `dev-export-sink.ts`'s `recipientLogRef`; unlike that helper's low-entropy email input,
 * ticket/agency-ref remainders carry enough entropy that an 8-hex-char prefix isn't
 * reversible in practice.
 */
function pathRemainderRef(remainder: string): string {
  return createHash("sha256").update(remainder).digest("hex").slice(0, 8);
}

const WALLET_SUFFIX_RE = /\/wallet\/(apple|google)$/;

/**
 * The same participant's link takes several shapes across ticket/QR/wallet routes — `/t/:token`,
 * `/t/:token/wallet/:platform`, `/q/:token.png`, and their `/t/:eventSlug/a/:ref` agency
 * equivalents — so the raw path remainder differs even though it's the same token/ref
 * underneath. Strip the `.png` suffix (`/q/*`) and the `/wallet/apple`|`/wallet/google` suffix
 * (`/t/*`) before hashing, so every route shape for one participant yields the same `ref`. For
 * Mode A this also makes `ref` the first 8 hex chars of the DB's own `token_hash` column (same
 * SHA-256 hash `hashToken()` computes), directly correlatable to `Attendee.token_hash`.
 */
function normalizeTokenRemainder(prefix: (typeof TOKEN_PATH_PREFIXES)[number], remainder: string): string {
  if (prefix === "/q/") return remainder.endsWith(".png") ? remainder.slice(0, -4) : remainder;
  return remainder.replace(WALLET_SUFFIX_RE, "");
}

/** Health probes fire every ~10s from Docker/proxies; only log them on failure. */
const HEALTH_PROBE_PATHS = new Set(["/healthz", "/readyz"]);

/** The System-logs live tail polls this endpoint every ~1.75s while open (CodeRabbit
 * review): logging each successful poll would put that poll's own entry in the buffer the
 * *next* poll reads, so an idle viewer just watching the tab continuously fills the
 * 1000-entry ring buffer with its own polling and evicts real diagnostics. Only log it on
 * failure, same as the health probes above. */
const SELF_LOG_EXEMPT_PATHS = new Set(["/api/admin/system-logs"]);

/** Replace token-bearing path remainders; query strings are never logged. */
export function redactRequestPath(pathname: string): string {
  for (const prefix of TOKEN_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return `${prefix}[redacted]`;
  }
  return pathname;
}

/**
 * For a `/t/*`/`/q/*` path, a short hash of the redacted remainder — same input always
 * yields the same ref, so repeated hits on one participant's link are recognizable across
 * log lines without the raw token ever reaching stdout. `undefined` for any other path.
 */
export function requestPathRef(pathname: string): string | undefined {
  for (const prefix of TOKEN_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      return pathRemainderRef(normalizeTokenRemainder(prefix, pathname.slice(prefix.length)));
    }
  }
  return undefined;
}

/** `LOG_HTTP_REQUESTS=1|true` enables the per-request access log (off by default). */
export function resolveLogHttpRequests(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env["LOG_HTTP_REQUESTS"] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * One JSON access-log line per request: method, redacted path, status, duration, client IP,
 * and (for `/t/*`/`/q/*`) a short non-reversible `ref` identifying which participant's link
 * was hit, without ever putting the raw token in the log. IP is logged for every request,
 * not only authenticated staff actors: the app already reads it for every anonymous
 * ticket/QR/check-in request to key its rate limiter (see `rate-limit/policies.ts`), so this
 * adds no new category of processing — it only surfaces, for the traffic most worth watching
 * for scanning/token-guessing, data the app was already computing. Matches standard access-log
 * practice (Apache/nginx combined format, ALB/CloudFront logs) and OWASP's guidance to record
 * source IP on security-relevant requests. See DATA-PROTECTION.md's Logs section.
 */
export function createRequestLogMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = performance.now();
    try {
      await next();
    } finally {
      const status = c.res?.status ?? 500;
      const path = new URL(c.req.url).pathname;
      if (!((HEALTH_PROBE_PATHS.has(path) || SELF_LOG_EXEMPT_PATHS.has(path)) && status < 400)) {
        const ref = requestPathRef(path);
        logger.info("http_request", {
          method: c.req.method,
          path: redactRequestPath(path),
          status,
          duration_ms: Math.round(performance.now() - startedAt),
          ip: resolveClientIp(c),
          ...(ref ? { ref } : {}),
        });
      }
    }
  };
}
