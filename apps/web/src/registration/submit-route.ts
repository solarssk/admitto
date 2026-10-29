/**
 * `POST /r/:slug`: a guest sends the registration form of an event (the contract with the page is
 * ./form-contract.ts, the pieces of the body are judged in ./submit-body.ts).
 *
 * Anonymous, and the most exposed route of the product, so what it does is in a fixed order, each step cheaper than
 * the one after it. A stranger who has not passed the bot challenge costs the reads that the page costs any visitor,
 * and writes nothing:
 *
 * 1. Before this handler (`registrationSubmitGuards`): the cross-site check, the limiter per client IP, the 64 KB cap.
 * 2. The body is JSON of the contract's shape, or the request is refused (415, 400). Nothing is read from the database.
 * 3. The event is looked up by the same rules as the page (`resolveRegistration`): an unknown slug, registration off,
 *    an archived event, an event that is over, a form that is not ready, all answer the one 404 of the registration
 *    routes, byte for byte. The page and this route decide from one read, so a form that is not shown cannot be sent,
 *    and a request tells a stranger no more about an event than the page does.
 * 4. The Cloudflare Turnstile token is checked (it is single use: the page asks for a new one after every answer).
 * 5. The per-event ceiling, keyed by event id: only now, so a stranger without a token cannot spend it.
 * 6. The event is looked up once more. The challenge is a call over the network, and an administrator may have closed the
 *    form meanwhile (a text unpublished, the keys removed, the way in switched off) or changed its questions: a form that
 *    is not open now is the same 404, and the fields are judged by what the form asks now. What `placeRegistration`
 *    rechecks itself, under its locks, is the mode, the archive and the end of the event.
 * 7. An event whose way in is the password (D-C3): the tries at it are counted, the client address's budget first and then
 *    the event's, and the password is checked, all before anything that depends on the address or on a field. The
 *    count comes after the challenge, so a bot that has no token spends nothing of the budget of a company behind one
 *    address, and the client's budget comes first, so a client that is out of tries cannot spend the event's. A password
 *    that is wrong, missing, not a text or too long is the one `403 access_denied`, and an event whose way in is the link
 *    ignores a password it is sent, with no error and no line in a log.
 * 8. The fields are judged (422 with a fixed sentence for each) and the terms must be accepted. So are the companions the guest
 *    brings: for an event that takes none, a body that has them is malformed (400), as it is for any key the page does not
 *    send, so the answer does not say what the event is set to. `placeRegistration` judges their number again under its locks.
 * 9. Only now the database is written, in `placeRegistration`, and the mail is queued in the same transaction. The mail
 *    of a new registration is withheld, not the registration, when the address or the event has spent its budget.
 *
 * What the guest is told does not depend on the address (D-B14). A new address, an address that has a registration in any
 * state, an address of an attendee in any status and one whose mail was withheld all get the same answer, with the same
 * headers, and not sooner than one another: the answer waits until a floor of time has passed since the challenge was
 * checked, so the extra work of storing a new registration does not show. The same holds for an event with a password,
 * where the guest who knows it is told what any guest is told (the list of guests is not given away to a group that
 * shares one password), and a wrong password waits for the same floor, which holds the hash of the check too. What may
 * differ does not depend on the address: the form is closed (404), full (409), the challenge or a field is refused (400,
 * 422), the password is refused (403), a limit is spent (429), a lock is held (503).
 *
 * Nothing that identifies a guest is written to a log, and no answer carries a word of an exception.
 */
import type { Context } from "hono";
import { Prisma, type PrismaClient } from "@admitto/db";
import { emitSystemLog, recordSystemLog } from "@admitto/shared/system-log";
import { placeRegistration, type PlaceRegistrationResult, type PublicWriteOptions, type RegistrantSubmission } from "@admitto/tickets";
import {
  INLINE_RATE_LIMITS,
  checkRegistrationEventRateLimit,
  checkRegistrationEventResendRateLimit,
  checkRegistrationMailRecipientRateLimit,
  checkRegistrationPasswordEventRateLimit,
  checkRegistrationPasswordRateLimit,
} from "../rate-limit/policies.js";
import type { RateLimitStore } from "../rate-limit/types.js";
import { respondRegistrationNotFound } from "../registration-page-security.js";
import { botChallengeFailureStatus, resolveChallengeHosts, verifyBotChallenge, type BotChallengeDeps } from "./bot-challenge.js";
import { isEventPassword, notePasswordTriesRefused } from "./event-password.js";
import {
  ACCESS_DENIED_ERROR,
  ERROR_KEY_CHALLENGE,
  ERROR_KEY_COMPANIONS,
  type RegistrationSubmitDenied,
  type RegistrationSubmitInvalid,
  type RegistrationSubmitOk,
} from "./form-contract.js";
import { resolveRegistration, type ResolvedRegistration } from "./form-model.js";
import {
  SUBMIT_MESSAGES,
  checkSubmission,
  readEnvelope,
  type SubmissionEnvelope,
  type SubmissionRules,
} from "./submit-body.js";

/** The least time an answer of "received" takes, counted from the end of the challenge check. The work of a new address
 * (a row, a mail row, perhaps an attendee) is a few milliseconds longer than the work of a known one on a database on
 * the same machine, and may be some tens across a network; the floor is far above that, so every address waits for the
 * floor and none for its own work. A first value, to be measured under load in the review of the whole release. */
export const ANSWER_FLOOR_MS = 250;

/** How long a guest is asked to wait after a 503, in seconds (the confirmation route asks the same). */
export const RETRY_AFTER_SECONDS = "5";

/** A line in the system log when an event's mail budget is spent, at most one an hour for an event, in this process:
 * the guests keep registering and nobody sees an error, so this is the one place an operator is told to raise
 * `registration:mail-event`. The id of an event, never anything of a guest. */
const BUDGET_LOG_INTERVAL_MS = 60 * 60 * 1000;
const MAX_EVENTS_NOTED = 500;
const budgetNotedAt = new Map<string, number>();

/** Exported for its test. */
export function noteEventBudgetSpent(eventId: string): void {
  const now = Date.now();
  const last = budgetNotedAt.get(eventId);
  if (last !== undefined && now - last < BUDGET_LOG_INTERVAL_MS) return;
  if (budgetNotedAt.size >= MAX_EVENTS_NOTED) budgetNotedAt.clear();
  budgetNotedAt.set(eventId, now);
  emitSystemLog("api", "warn", "registration_mail_withheld", { event_id: eventId, reason: "event_budget" });
}

/** The clock the floor is counted on, and the wait. The default is the real one; a test passes its own. */
export interface AnswerPace {
  floorMs: number;
  now(): number;
  sleep(ms: number): Promise<void>;
}

const REAL_PACE: AnswerPace = {
  floorMs: ANSWER_FLOOR_MS,
  now: () => performance.now(),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};

/** Waits until the floor has passed since `startedAt` (a reading of `pace.now()`); at once when it has. */
export async function holdAnswer(pace: AnswerPace, startedAt: number): Promise<void> {
  const left = pace.floorMs - (pace.now() - startedAt);
  if (left > 0) await pace.sleep(left);
}

export interface RegistrationSubmitDeps {
  db: PrismaClient;
  store: RateLimitStore;
  /** The instance URL the app was started with: the host a challenge may have been solved on. */
  injectedBaseUrl?: string;
  /** Test only: the transport of the challenge check. */
  challenge?: BotChallengeDeps;
  /** Test only: how long a write waits for a lock, and how many may try at once. */
  placement?: PublicWriteOptions;
  /** Test only: the floor of time and the clock it is counted on. */
  pace?: AnswerPace;
}

type JsonStatus = 200 | 400 | 403 | 409 | 415 | 422 | 429 | 500 | 503;

/** Every JSON answer of the route: the same headers, whatever it says. */
function json(c: Context, body: unknown, status: JsonStatus): Response {
  c.header("Cache-Control", "private, no-store, max-age=0");
  c.header("X-Content-Type-Options", "nosniff");
  return c.json(body, status);
}

const received = (c: Context): Response => json(c, { ok: true } satisfies RegistrationSubmitOk, 200);

const malformed = (c: Context): Response => json(c, { error: "invalid_request" }, 400);

const tooManyRequests = (c: Context): Response => json(c, { error: "too many requests" }, 429);

/** The one answer to a password that does not open the event, for every reason and every address. */
const accessDenied = (c: Context): Response => json(c, { error: ACCESS_DENIED_ERROR } satisfies RegistrationSubmitDenied, 403);

function tryAgain(c: Context): Response {
  c.header("Retry-After", RETRY_AFTER_SECONDS);
  return json(c, { error: "try_again" }, 503);
}

function invalid(c: Context, errors: ReadonlyMap<string, string>): Response {
  return json(c, { errors: Object.fromEntries(errors) } satisfies RegistrationSubmitInvalid, 422);
}

/** `application/json`, with or without parameters. A page of another site cannot send this type without a CORS
 * preflight, which this route never answers, so the type is a second brake behind the cross-site check. */
function isJson(contentType: string | undefined): boolean {
  return (contentType ?? "").split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

/** The body as an envelope, or the answer that refuses it. Any failure to read it is a malformed request. */
async function readBody(c: Context): Promise<SubmissionEnvelope | Response> {
  if (!isJson(c.req.header("content-type"))) return json(c, { error: "unsupported_media_type" }, 415);
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return malformed(c);
  }
  return readEnvelope(raw) ?? malformed(c);
}

function refuseField(c: Context, key: string, message: string): Response {
  return json(c, { errors: { [key]: message } } satisfies RegistrationSubmitInvalid, 400);
}

/** The answer that refuses the challenge, or null when it passed. 400 when the token is at fault; 503 when the check
 * could not be made or the instance is not set up for it. The same sentence for every reason of the first kind. */
async function refuseChallenge(
  c: Context,
  deps: RegistrationSubmitDeps,
  slug: string,
  token: unknown,
): Promise<Response | null> {
  const expectedHosts = await resolveChallengeHosts(deps.db, { injectedBaseUrl: deps.injectedBaseUrl });
  const result = await verifyBotChallenge(deps.db, { token, expectedHosts, slug }, deps.challenge);
  if (result.ok) return null;
  if (botChallengeFailureStatus(result.reason) === 503) return tryAgain(c);
  return refuseField(c, ERROR_KEY_CHALLENGE, SUBMIT_MESSAGES.challenge);
}

/**
 * The submission becomes a registration. Two budgets can withhold its mail without stopping it (MN-05): the event's,
 * counted in the database by `placeRegistration` under its lock, and the address's, asked by `placeRegistration` too,
 * only when it is about to queue the mail of a registration it stores. A request that is told to try again, finds the
 * event full or the address known, spends nothing of the address's budget. The registration is made the way the event's
 * way in says: the link and the password both mail the address a confirmation link first (D-C5).
 */
function placeSubmission(
  deps: RegistrationSubmitDeps,
  { eventId, access }: Pick<Extract<ResolvedRegistration, { kind: "open" }>, "eventId" | "access">,
  registrant: RegistrantSubmission,
): Promise<PlaceRegistrationResult> {
  const budget = INLINE_RATE_LIMITS["registration:mail-event"];
  return placeRegistration(
    deps.db,
    { eventId, method: access.method, registrant },
    {
      ...deps.placement,
      mail: {
        addressAllowed: () => checkRegistrationMailRecipientRateLimit(deps.store, registrant.email),
        resendAllowed: (cap) => checkRegistrationEventResendRateLimit(deps.store, eventId, cap),
        event: { base: budget.max, windowMs: budget.windowMs },
        onWithheld: (reason) => {
          if (reason === "event") noteEventBudgetSpent(eventId);
        },
      },
    },
  );
}

/** What a stored submission is answered with (D-B14): see the head of this file for what may differ. */
async function answerPlacement(
  c: Context,
  placed: PlaceRegistrationResult,
  hold: () => Promise<void>,
): Promise<Response> {
  switch (placed.outcome) {
    // `already_registered` is the answer of single sign-on only; the link never gets it, and would answer as below.
    case "received":
    case "already_registered":
      await hold();
      return received(c);
    case "closed":
      return respondRegistrationNotFound(c);
    case "full":
      return json(c, { error: "full" }, 409);
    // The event took fewer companions by the time the locks were held than when the body was judged: the same refusal as a body
    // that brings too many, whatever the address.
    case "too_many_companions":
      return invalid(c, new Map([[ERROR_KEY_COMPANIONS, SUBMIT_MESSAGES.tooManyCompanions]]));
    case "busy":
      return tryAgain(c);
  }
}

/** The questions and consents of an open form, as the checks need them. */
function rulesOf(target: Extract<ResolvedRegistration, { kind: "open" }>, now: Date): SubmissionRules {
  const { form } = target;
  return {
    askCompany: form.askCompany,
    askDepartment: form.askDepartment,
    fields: target.fields,
    consentKeys: form.consents.map((consent) => consent.key),
    companionMax: form.companion?.max ?? 0,
    now,
  };
}

/**
 * The answer that refuses the password of an event whose way in is the password, or null when the guest may go on (and
 * for an event that has another way in, which has no password to check). The two budgets are spent by every try that
 * gets here, the right ones too (see `registration:password`); a refusal for want of a budget is a 429 like the event's
 * ceiling, and writes one line for the operator with the id of the event and nothing of the guest or the client. A wrong
 * password waits for the floor of time before it is answered, like every answer that follows the challenge.
 */
async function refusePassword(
  c: Context,
  deps: RegistrationSubmitDeps,
  open: Extract<ResolvedRegistration, { kind: "open" }>,
  password: unknown,
  hold: () => Promise<void>,
): Promise<Response | null> {
  if (open.access.method !== "password") return null;
  if (!(await checkRegistrationPasswordRateLimit(deps.store, c))) {
    notePasswordTriesRefused(open.eventId, "client");
    return tooManyRequests(c);
  }
  if (!(await checkRegistrationPasswordEventRateLimit(deps.store, open.eventId))) {
    notePasswordTriesRefused(open.eventId, "event");
    return tooManyRequests(c);
  }
  if (await isEventPassword(password, open.access.passwordHash)) return null;
  await hold();
  return accessDenied(c);
}

async function submit(c: Context, deps: RegistrationSubmitDeps): Promise<Response> {
  const now = new Date();
  const envelope = await readBody(c);
  if (envelope instanceof Response) return envelope;

  const slug = c.req.param("slug") ?? "";
  const target = await resolveRegistration(deps.db, slug, now);
  if (target.kind !== "open") return respondRegistrationNotFound(c);

  const refusal = await refuseChallenge(c, deps, target.form.event.slug, envelope.challenge);
  if (refusal) return refusal;
  const pace = deps.pace ?? REAL_PACE;
  const startedAt = pace.now();
  if (!(await checkRegistrationEventRateLimit(deps.store, target.eventId))) return tooManyRequests(c);

  // The second look (step 6 of the head of this file): the same lookup as the first, so that the form the guest is judged
  // against, and written for, is the one that is open now and not the one that was open before the challenge.
  const open = await resolveRegistration(deps.db, slug, new Date());
  if (open.kind !== "open") return respondRegistrationNotFound(c);

  // The password (step 7 of the head of this file) is judged by the event as the second look found it: an event that was
  // switched to the password between the two looks asks for it, and one switched away from it does not.
  const hold = () => holdAnswer(pace, startedAt);
  const refused = await refusePassword(c, deps, open, envelope.password, hold);
  if (refused) return refused;

  const checked = checkSubmission(envelope, rulesOf(open, now));
  if (checked.kind === "malformed") return malformed(c);
  if (checked.kind === "invalid") return invalid(c, checked.errors);

  let placed: PlaceRegistrationResult;
  try {
    placed = await placeSubmission(deps, open, checked.registrant);
  } catch (error) {
    if (prismaCode(error) !== "P2002") throw error;
    // The address got a registration while this request ran: the guest is told what a known address is told, and after
    // the same wait, as the work of a new address is the one thing the wait is there to hide.
    placed = { outcome: "received" };
  }
  return answerPlacement(c, placed, hold);
}

export function prismaCode(error: unknown): string | undefined {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
}

/** A failure nobody expected, or a race with another writer. Only the class of the error is logged: the message of
 * a database error can carry a value, and a value here is a guest's name or address. */
function answerFailure(c: Context, error: unknown): Response {
  const code = prismaCode(error);
  // The event was deleted while the request ran (SEC-08, ERA-14): as if it had never been there.
  if (code === "P2003") return respondRegistrationNotFound(c);
  console.error("registration submit failed:", { reason: error instanceof Error ? error.name : "unknown", code });
  recordSystemLog({ level: "error", source: "api", message: "registration_submit_failed", fields: { route: "/r/:slug" } });
  return json(c, { error: "internal_error" }, 500);
}

export async function handlePostRegistration(c: Context, deps: RegistrationSubmitDeps): Promise<Response> {
  try {
    return await submit(c, deps);
  } catch (error) {
    return answerFailure(c, error);
  }
}
