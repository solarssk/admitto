import type { CfAccessSummaryDto, CfAccessUpdateBody } from "../api/types.js";

/** Editable Cloudflare Access draft. `audience` and `protectedPrefixes` are kept as
 *  arrays (the API shape) so dirty-checking is structural equality, not string
 *  comparison; the editor wires them to comma-separated text inputs via
 *  `parseListInput` / `joinListInput`. */
export interface CfAccessDraft {
  enabled: boolean;
  teamDomain: string;
  audience: string[];
  protectedPrefixes: string[];
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
    .filter(Boolean);
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
  return { enabled: false, teamDomain: "", audience: [], protectedPrefixes: [] };
}

/** Seed a draft from the loaded summary DTO (the GET response already carries the
 *  resolved arrays + env locks). */
export function cfDraftFromSummary(summary: CfAccessSummaryDto): CfAccessDraft {
  return {
    enabled: summary.enabled,
    teamDomain: summary.teamDomain,
    audience: summary.audience,
    protectedPrefixes: summary.protectedPrefixes,
  };
}

export function isCfDraftDirty(draft: CfAccessDraft, baseline: CfAccessDraft): boolean {
  return (
    draft.enabled !== baseline.enabled ||
    draft.teamDomain.trim() !== baseline.teamDomain.trim() ||
    !arraysEqual(draft.audience, baseline.audience) ||
    !arraysEqual(draft.protectedPrefixes, baseline.protectedPrefixes)
  );
}

/** Client-side validation mirroring the server's boot-config rules
 *  (`validateCfAccessBootConfigFromResolved`) plus a light URL-prefix check on the
 *  team domain. The server remains authoritative; these give the operator inline
 *  feedback before the round-trip. */
export function validateCfDraft(draft: CfAccessDraft): CfAccessFieldErrors {
  const errors: CfAccessFieldErrors = {};
  const teamDomain = draft.teamDomain.trim();

  if (draft.enabled && !teamDomain) {
    errors.teamDomain = "Team URL is required when Cloudflare Access is enabled.";
  } else if (teamDomain && !/^https?:\/\//i.test(teamDomain)) {
    errors.teamDomain = "Team URL must start with http:// or https://";
  }

  if (draft.enabled && draft.audience.length === 0) {
    errors.audience = "At least one Application Audience (AUD) tag is required when enabled.";
  }

  if (draft.protectedPrefixes.some((p) => !p.startsWith("/"))) {
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
  if (!locks.audience) body.audience = draft.audience;
  if (!locks.protectedPrefixes) body.protectedPrefixes = draft.protectedPrefixes;
  return body;
}
