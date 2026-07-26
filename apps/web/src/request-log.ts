import type { MiddlewareHandler } from "hono";
import { logger } from "./logger.js";

/**
 * Path prefixes whose remainder embeds ticket/QR tokens (`/t/:token`,
 * `/q/{token}.png`) — never log the raw path (SECURITY-CONTROLS: no secrets
 * in stdout).
 */
const TOKEN_PATH_PREFIXES = ["/t/", "/q/"] as const;

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

/** `LOG_HTTP_REQUESTS=1|true` enables the per-request access log (off by default). */
export function resolveLogHttpRequests(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env["LOG_HTTP_REQUESTS"] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * One JSON access-log line per request: method, redacted path, status,
 * duration. Deliberately no IP, user agent, cookies, or query string — the
 * default log stream stays free of personal data and secrets; request-level
 * attribution belongs to the reverse proxy and the DB audit log.
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
        logger.info("http_request", {
          method: c.req.method,
          path: redactRequestPath(path),
          status,
          duration_ms: Math.round(performance.now() - startedAt),
        });
      }
    }
  };
}
