import { parsePositiveInteger } from "../checkin-stream-config.js";

type EnvLike = Record<string, string | undefined>;

/** A limit that can be retuned: the shape shared by a policy's checks and by the inline limits. */
interface Tunable {
  windowMs: number;
  max: number;
}

type PolicyTable = Record<string, { checks: Tunable[] }>;
type InlineTable = Record<string, Tunable>;

export const RATE_LIMIT_OVERRIDES_ENV = "RATE_LIMIT_OVERRIDES";

/** Policies that have their own dedicated variables and must not be tuned twice. */
const OWN_VARIABLES: Readonly<Record<string, string>> = {
  "checkin:stream": "CHECKIN_STREAM_*",
};

/** Applies one `{ "max": n, "windowMs": n }` entry to a limit; returns false when it is not usable. */
function applyEntry(target: Tunable, entry: unknown, label: string): boolean {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    console.warn(`${RATE_LIMIT_OVERRIDES_ENV}: "${label}" needs an object like {"max": 30}; ignored.`);
    return false;
  }
  const next = { ...target };
  for (const [field, raw] of Object.entries(entry)) {
    if (field !== "max" && field !== "windowMs") {
      console.warn(`${RATE_LIMIT_OVERRIDES_ENV}: "${label}" has unknown field "${field}"; entry ignored.`);
      return false;
    }
    const parsed = typeof raw === "number" ? parsePositiveInteger(String(raw)) : undefined;
    if (parsed === undefined) {
      console.warn(
        `${RATE_LIMIT_OVERRIDES_ENV}: "${label}" ${field} must be a positive integer (got: ${JSON.stringify(raw)}); entry ignored.`,
      );
      return false;
    }
    next[field] = parsed;
  }
  Object.assign(target, next);
  return true;
}

/**
 * Retune named rate limits from `RATE_LIMIT_OVERRIDES`, a JSON object keyed by policy name:
 *
 *   {"auth:login-ip": {"max": 30}, "admin:resend": [{"max": 10}, {"max": 60}]}
 *
 * A single-check policy (or an inline limit) takes an object; a policy with several checks takes
 * an array with one entry per check, in registry order (`null` keeps a check as it is). Fields are
 * `max` and `windowMs`, both positive integers. Anything unusable is skipped with a boot warning
 * naming it, and the rest still applies: a typo must not silently switch a protection off or
 * leave the whole app unable to start. Called once, when the registry is built, so a change needs
 * a restart, not a rebuild.
 */
export function applyRateLimitOverrides(
  policies: PolicyTable,
  inline: InlineTable,
  env: EnvLike = process.env,
): void {
  const raw = env[RATE_LIMIT_OVERRIDES_ENV];
  if (raw === undefined || raw.trim() === "") return;

  const overrides = parseOverrides(raw);
  if (!overrides) return;

  for (const [name, value] of Object.entries(overrides)) {
    applyNamedOverride(policies, inline, name, value);
  }
}

/** The variable's JSON as an object keyed by limit name, or `undefined` (with a warning) when it
 * is not valid JSON or not an object. */
function parseOverrides(raw: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`${RATE_LIMIT_OVERRIDES_ENV} is not valid JSON; no override applied.`);
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn(`${RATE_LIMIT_OVERRIDES_ENV} must be a JSON object keyed by policy name; no override applied.`);
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

/** Route one `name: value` entry to the policy or inline limit it names. */
function applyNamedOverride(policies: PolicyTable, inline: InlineTable, name: string, value: unknown): void {
  const ownVariables = Object.hasOwn(OWN_VARIABLES, name) ? OWN_VARIABLES[name] : undefined;
  if (ownVariables) {
    console.warn(`${RATE_LIMIT_OVERRIDES_ENV}: "${name}" is set with ${ownVariables}; entry ignored.`);
    return;
  }

  const policy = Object.hasOwn(policies, name) ? policies[name] : undefined;
  if (policy) {
    applyToPolicy(policy.checks, value, name);
    return;
  }
  const inlineLimit = Object.hasOwn(inline, name) ? inline[name] : undefined;
  if (inlineLimit) {
    applyEntry(inlineLimit, value, name);
    return;
  }
  console.warn(`${RATE_LIMIT_OVERRIDES_ENV}: unknown limit "${name}"; entry ignored.`);
}

function applyToPolicy(checks: Tunable[], value: unknown, name: string): void {
  const [only] = checks;
  if (only && checks.length === 1 && !Array.isArray(value)) {
    applyEntry(only, value, name);
    return;
  }
  if (!Array.isArray(value) || value.length !== checks.length) {
    console.warn(
      `${RATE_LIMIT_OVERRIDES_ENV}: "${name}" has ${checks.length} check(s) and needs an array of ${checks.length} entries; entry ignored.`,
    );
    return;
  }
  value.forEach((entry, index) => {
    const check = checks[index];
    if (check && entry !== null) applyEntry(check, entry, `${name}[${index}]`);
  });
}
