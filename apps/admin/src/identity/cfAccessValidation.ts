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

/** Normalize a single parsed value: trim, drop empties. */
function toValue(v: unknown): string {
  return String(v).trim();
}

/** Split a comma-separated text input into a trimmed, de-duplicated value list.
 *  Accepts a JSON-array form (e.g. `["aud-1","aud-2"]`) for parity with the legacy
 *  CF Access form and the server's `parseAudience` / `parsePrefixes` — otherwise
 *  pasting a JSON array would split on commas and persist literal brackets/quotes
 *  as AUD values, breaking Cloudflare JWT audience checks after enabling Access. */
export function parseListInput(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map(toValue)
          .filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i);
      }
    } catch {
      // fall through to comma split
    }
  }
  return raw
    .split(",")
    .map(toValue)
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
 *  (`validateCfAccessBootConfigFromResolved`) and team-domain normalizer
 *  (`normalizeCfAccessTeamDomain`). The server accepts either
 *  `https://<team>.cloudflareaccess.com` or a schemeless host (it prepends
 *  `https://`), and rejects `http://` / other schemes; this validation matches
 *  that so an env-locked schemeless team domain doesn't block an otherwise-valid
 *  save/toggle. The server remains authoritative on the host shape. */
export function validateCfDraft(draft: CfAccessDraft): CfAccessFieldErrors {
  const errors: CfAccessFieldErrors = {};
  const teamDomain = draft.teamDomain.trim();
  const audience = parseListInput(draft.audienceRaw);
  const protectedPrefixes = parseListInput(draft.protectedPrefixesRaw);

  if (draft.enabled && !teamDomain) {
    errors.teamDomain = "Team URL is required when Cloudflare Access is enabled.";
  } else {
    // Any explicit scheme must be https://; a schemeless host is accepted (the
    // server normalizer prepends https://). http:// and other schemes are
    // rejected inline so the operator doesn't save a URL sign-in will reject.
    const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(teamDomain);
    if (schemeMatch && schemeMatch[1].toLowerCase() !== "https") {
      errors.teamDomain = "Team URL must use https://";
    }
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
