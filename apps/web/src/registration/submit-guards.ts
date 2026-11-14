import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createCrossSitePostGuard } from "../auth/same-origin-post.js";
import { rateLimit } from "../rate-limit/policies.js";
import type { RateLimitStore } from "../rate-limit/types.js";

/** Largest body the anonymous registration POST reads. A realistic body is under 8 KB (two names,
 * an email, up to 20 values of at most 1000 characters); the app enforces its own cap because some
 * topologies (Portainer/NAS) have no nginx in front. */
export const MAX_REGISTRATION_BODY_BYTES = 64 * 1024;

export const registrationBodyLimit = bodyLimit({
  maxSize: MAX_REGISTRATION_BODY_BYTES,
  onError: (c) => c.json({ error: "request too large" }, 413),
});

/**
 * The fixed first three steps of `POST /r/:slug`, in the only order that works: the cross-site
 * guard (a browser-only check, not a bot control), then the IP limiter, then the body cap. The
 * limiter runs before the cap because a chunked body is read up to the cap before the 413, so a
 * limiter placed after it would never count those requests. Parsing, the bot challenge and the
 * per-event and per-address limits come after, in the handler.
 */
export function registrationSubmitGuards(
  store: RateLimitStore,
): [MiddlewareHandler, MiddlewareHandler, MiddlewareHandler] {
  return [
    createCrossSitePostGuard({ format: "json" }),
    rateLimit(store, "registration:submit"),
    registrationBodyLimit,
  ];
}
