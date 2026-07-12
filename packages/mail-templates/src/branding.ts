import type { Prisma, PrismaClient } from "@prisma/client";
import type { BrandingUrls } from "./types.js";
import { validateBrandingUrl, InvalidHttpUrlError } from "./escape.js";

function pickUrl(eventValue: string | null | undefined, orgValue: string | null | undefined): string {
  const event = eventValue?.trim() ?? "";
  if (event !== "") return event;
  const org = orgValue?.trim() ?? "";
  return org;
}

type BrandingEvent = {
  logo_url: string | null;
  header_image_url: string | null;
  organization: { logo_url: string | null; header_image_url: string | null };
};

/** Resolves branding URLs from a preloaded event row (event → organization → empty). */
export function resolveBrandingFromEvent(event: BrandingEvent): BrandingUrls {
  return {
    logo_url: pickUrl(event.logo_url, event.organization.logo_url),
    header_image_url: pickUrl(event.header_image_url, event.organization.header_image_url),
  };
}

/**
 * Resolves branding URLs: event → organization → empty default.
 * MVP: stored as columns on Organization/Event (no separate BrandingSettings model).
 */
export async function resolveBranding(
  eventId: string,
  prisma: PrismaClient,
): Promise<BrandingUrls> {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { organization: true },
  });

  return resolveBrandingFromEvent(event);
}

export interface SetBrandingInput {
  logoUrl?: string | null;
  headerImageUrl?: string | null;
}

function normalizeOptionalUrl(field: string, value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  validateBrandingUrl(field, trimmed);
  return trimmed;
}

/** Set branding URLs on organization or event scope. */
type BrandingUpdateData = {
  logo_url?: string | null;
  header_image_url?: string | null;
};

function buildBrandingUpdateData(input: SetBrandingInput): BrandingUpdateData {
  const data: BrandingUpdateData = {};
  if (input.logoUrl !== undefined) {
    data.logo_url = normalizeOptionalUrl("logo_url", input.logoUrl);
  }
  if (input.headerImageUrl !== undefined) {
    data.header_image_url = normalizeOptionalUrl("header_image_url", input.headerImageUrl);
  }
  return data;
}

export async function setBranding(
  scope: { scopeType: "organization" | "event"; scopeId: string },
  input: SetBrandingInput,
  prisma: PrismaClient,
): Promise<void> {
  const data = buildBrandingUpdateData(input);
  if (Object.keys(data).length === 0) return;

  if (scope.scopeType === "organization") {
    await prisma.organization.update({
      where: { id: scope.scopeId },
      data,
    });
    return;
  }

  await prisma.event.update({
    where: { id: scope.scopeId },
    data,
  });
}

/** An event's custom image asset tokens (branding asset library, v0.4.13 batch 05), resolved
 * to their stored `/uploads/…` URLs for use as extra TemplateVars, plus the set of token names
 * for widening the placeholder whitelist (see findUnknownPlaceholders' extraAllowed param and
 * RenderOptions.customAssetPlaceholders). Empty when the event has no uploaded assets. */
export interface EventImageAssetPlaceholders {
  vars: Record<string, string>;
  names: ReadonlySet<string>;
}

export async function resolveEventImageAssetVars(
  eventId: string,
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<EventImageAssetPlaceholders> {
  const assets = await prisma.eventImageAsset.findMany({
    where: { event_id: eventId },
    select: { token: true, url: true },
  });

  const vars: Record<string, string> = {};
  for (const asset of assets) {
    vars[asset.token] = asset.url;
  }

  return { vars, names: new Set(Object.keys(vars)) };
}

export { InvalidHttpUrlError };
