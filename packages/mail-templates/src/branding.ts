import type { PrismaClient } from "@prisma/client";
import type { BrandingUrls } from "./types.js";
import { validateHttpUrl, InvalidHttpUrlError } from "./escape.js";

function pickUrl(eventValue: string | null | undefined, orgValue: string | null | undefined): string {
  const event = eventValue?.trim() ?? "";
  if (event !== "") return event;
  const org = orgValue?.trim() ?? "";
  return org;
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

  return {
    logo_url: pickUrl(event.logo_url, event.organization.logo_url),
    header_image_url: pickUrl(event.header_image_url, event.organization.header_image_url),
  };
}

export interface SetBrandingInput {
  logoUrl?: string | null;
  headerImageUrl?: string | null;
}

function normalizeOptionalUrl(field: string, value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  validateHttpUrl(field, trimmed);
  return trimmed;
}

/** Set branding URLs on organization or event scope. */
export async function setBranding(
  scope: { scopeType: "organization" | "event"; scopeId: string },
  input: SetBrandingInput,
  prisma: PrismaClient,
): Promise<void> {
  const logoUrl = normalizeOptionalUrl("logo_url", input.logoUrl);
  const headerImageUrl = normalizeOptionalUrl("header_image_url", input.headerImageUrl);

  if (scope.scopeType === "organization") {
    await prisma.organization.update({
      where: { id: scope.scopeId },
      data: { logo_url: logoUrl, header_image_url: headerImageUrl },
    });
    return;
  }

  await prisma.event.update({
    where: { id: scope.scopeId },
    data: { logo_url: logoUrl, header_image_url: headerImageUrl },
  });
}

export { InvalidHttpUrlError };
