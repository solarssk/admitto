import type { MiddlewareHandler } from "hono";
import { Prisma } from "@admitto/db/client";
import { isUnstorableValueError } from "@admitto/db/errors";

/** U+0000 in its only form a URL can carry it. Checked on the raw URL, so the path and the query
 * are covered alike, before a router or a handler decodes anything. An escaped percent sign
 * followed by 00 (`%2500`) decodes once to the text `%00`, not to U+0000, and passes. */
const ENCODED_NUL = /%00/;

/**
 * Answers 400 for a request whose path or query carries U+0000. Postgres cannot store the
 * character, so a handler that passes such a path parameter or search value to a query fails with
 * a database error; refusing the request here keeps every route from having to check. Registered
 * ahead of the routes (and their rate limits): the request costs nothing, and no account or
 * session is involved.
 */
export const rejectNulInRequestTarget: MiddlewareHandler = async (c, next) => {
  if (ENCODED_NUL.test(c.req.url)) {
    return c.json({ error: "invalid_request" }, 400);
  }
  await next();
};

/** What to answer instead of a bare 500 when a handler lets a database error escape. */
export type RequestRejection = { status: 400 | 404; error: "invalid_request" | "not_found" };

/**
 * Maps a database error that the request itself caused to a 4xx: a record or parent row the
 * request names that is not there (P2025, P2003), or a value Postgres refuses to store as
 * malformed (a body string with U+0000). Anything else - a unique conflict, a timeout, a lost
 * connection - stays a server error.
 */
export function requestRejectionForError(err: unknown): RequestRejection | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (err.code === "P2025" || err.code === "P2003") return { status: 404, error: "not_found" };
  if (isUnstorableValueError(err)) return { status: 400, error: "invalid_request" };
  return null;
}
