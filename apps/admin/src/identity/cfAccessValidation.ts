import type { CfAccessSummaryDto, CfAccessUpdateBody } from "../api/types.js";

/** Editable Cloudflare Access draft. `audienceRaw` and `protectedPrefixesRaw` hold
 *  the verbatim comma-separated text the operator is typing so a trailing comma or
 *  space isn't stripped mid-entry (parsing on every keystroke made multi-value
 *  typing impossible — `parseListInput` is applied on blur / save / validate). */
export interface CfAccessDraft {
  enabled: boolean;
  teamDomain: string;
  audienceRaw: string;
  protectedPrefixesRaw: string;
}

export type CfAccessFieldErrors = {
  teamDomain?: string;
  audience?: string;
  protectedPrefixes?: string;
};

/** Split a comma-separated text input into a trimmed, de-duplicated value list. */
export function parseListInput(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

/** Render an array back as the comma-separated text a text input shows. */
export function joinListInput(values: string[]): string {
  return values.join(", ");
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export function emptyCfDraft(): CfAccessDraft {
  return { enabled: false, teamDomain: "", audienceRaw: "", protectedPrefixesRaw: "" };
}

/** Seed a draft from the loaded summary DTO (the GET response already carries the
 *  resolved arrays + env locks). Lists are rendered back to comma-separated text. */
export function cfDraftFromSummary(summary: CfAccessSummaryDto): CfAccessDraft {
  return {
    enabled: summary.enabled,
    teamDomain: summary.teamDomain,
    audienceRaw: joinListInput(summary.audience),
    protectedPrefixesRaw: joinListInput(summary.protectedPrefixes),
  };
}

/** Semantic dirty check: compares the parsed arrays (so a trailing comma in the
 *  raw text is not treated as a change) and the trimmed team domain + enabled flag. */
export function isCfDraftDirty(draft: CfAccessDraft, baseline: CfAccessDraft): boolean {
  return (
    draft.enabled !== baseline.enabled ||
    draft.teamDomain.trim() !== baseline.teamDomain.trim() ||
    !arraysEqual(parseListInput(draft.audienceRaw), parseListInput(baseline.audienceRaw)) ||
    !arraysEqual(parseListInput(draft.protectedPrefixesRaw), parseListInput(baseline.protectedPrefixesRaw))
  );
}

/** Client-side validation mirroring the server's boot-config rules
 *  (`validateCfAccessBootConfigFromResolved`). The team domain must be HTTPS —
 *  Cloudflare Access team URLs are always served over HTTPS, so `http://` is
 *  rejected inline rather than letting the operator save a URL that JWKS / sign-in
 *  will reject. The server remains authoritative; these give the operator inline
 *  feedback before the round-trip. */
export function validateCfDraft(draft: CfAccessDraft): CfAccessFieldErrors {
  const errors: CfAccessFieldErrors = {};
  const teamDomain = draft.teamDomain.trim();
  const audience = parseListInput(draft.audienceRaw);
  const protectedPrefixes = parseListInput(draft.protectedPrefixesRaw);

  if (draft.enabled && !teamDomain) {
    errors.teamDomain = "Team URL is required when Cloudflare Access is enabled.";
  } else if (teamDomain && !/^https:\/\//i.test(teamDomain)) {
    errors.teamDomain = "Team URL must start with https://";
  }

  if (draft.enabled && audience.length === 0) {
    errors.audience = "At least one Application Audience (AUD) tag is required when enabled.";
  }

  if (protectedPrefixes.some((p) => !p.startsWith("/"))) {
    errors.protectedPrefixes = "Each protected path must start with /.";
  }

  return errors;
}

/** Build the PATCH-style PUT body, omitting env-locked fields so the server keeps
 *  the locked (env-managed) value rather than echoing back a stale draft copy. */
export function buildCfUpdateBody(
  draft: CfAccessDraft,
  locks: CfAccessSummaryDto["locks"],
): CfAccessUpdateBody {
  const body: CfAccessUpdateBody = {};
  if (!locks.enabled) body.enabled = draft.enabled;
  if (!locks.teamDomain) body.teamDomain = draft.teamDomain.trim();
  if (!locks.audience) body.audience = parseListInput(draft.audienceRaw);
  if (!locks.protectedPrefixes) body.protectedPrefixes = parseListInput(draft.protectedPrefixesRaw);
  return body;
}
