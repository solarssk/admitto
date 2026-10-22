import type { PrismaClient } from "@admitto/db";
import {
  MissingRequiredPlaceholderError,
  buildEventLocationTemplateVars,
  findMissingRequiredPlaceholders,
  renderTemplate,
  requiredPlaceholdersForTemplate,
  resolveBrandingFromEvent,
  resolveEventContactVars,
  resolveEventImageAssetVars,
  type RenderedTemplate,
  type ResolvedTemplate,
  type TemplateVars,
} from "@admitto/mail-templates";
import { formatDate, formatEventHoursRangeText } from "@admitto/shared/region-date-format";
import { parseTicketAddressComponents } from "@admitto/tickets";
import { buildConfirmUrl } from "./links.js";
import type { RegistrationForMail } from "./registration-mail-check.js";

/** What one event contributes to every registration mail of a drain, read once per event and tick. */
export interface EventMailFacts {
  organizationId: string;
  slug: string;
  /** Event name, date, place, branding, the event's image tokens and its contact: no value of any guest. */
  vars: TemplateVars;
  /** The event's image token names, which the renderer accepts besides the fixed placeholders. */
  assetNames: ReadonlySet<string>;
}

export async function loadEventMailFacts(
  prisma: PrismaClient,
  eventId: string,
  baseUrl: string,
  env: NodeJS.ProcessEnv,
): Promise<EventMailFacts> {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { organization: true, location_details: true },
  });
  const [assets, contact] = await Promise.all([
    resolveEventImageAssetVars(eventId, prisma),
    resolveEventContactVars(eventId, prisma),
  ]);
  const branding = resolveBrandingFromEvent(event);
  const country = parseTicketAddressComponents(event.location_details?.address_components)?.country ?? null;
  return {
    organizationId: event.organization_id,
    slug: event.slug,
    assetNames: assets.names,
    vars: {
      event_name: event.title,
      event_date: formatDate(event.date, country),
      event_hours: formatEventHoursRangeText(event.event_hours_start, event.event_hours_end, country, event.timezone, event.date),
      ...buildEventLocationTemplateVars(event.id, event.location_details, baseUrl, env),
      logo_url: branding.logo_url,
      header_image_url: branding.header_image_url,
      ...assets.vars,
      ...contact,
    },
  };
}

/**
 * Whether the guest's own words (the names) may go into a mail. Until the address is known to be theirs, anyone can
 * type any text for any address, so a mail to an unconfirmed address carries no name: the greeting and the subject
 * hold only what the event says. The rule is in the data the template is rendered with, not in the default text,
 * because a template is editable and `first_name`, `last_name` and `full_name` are allowed in it. The address is
 * theirs once they confirmed it (or signed in through the identity provider), and staff decided about the
 * registration only after they read it.
 */
function mayShowNames(registration: RegistrationForMail): boolean {
  return registration.email_verified_at !== null || registration.decided_by !== null;
}

/**
 * Renders one registration mail for one guest from the template as it is now, with the full placeholder check
 * (fail closed: a template that cannot be rendered throws, and the caller fails that one row for good). Pure: no
 * database, no network. Ticket, QR and wallet links belong to an attendee and stay empty here, so a template that
 * holds one fails (a `{{ticket_url}}` is a required link).
 */
export function renderRegistrationMail(
  facts: EventMailFacts,
  template: ResolvedTemplate,
  templateName: string,
  registration: RegistrationForMail,
  baseUrl: string,
): RenderedTemplate {
  // The mail that confirms an address, without its link, would be sent and counted as sent, and the guest could do nothing
  // with it. A template saved before this was checked (or edited by hand) fails its row for good instead.
  const missing = findMissingRequiredPlaceholders("", template.compiledHtmlTemplate, requiredPlaceholdersForTemplate(templateName));
  if (missing.length > 0) throw new MissingRequiredPlaceholderError(missing);
  const named = mayShowNames(registration);
  // Where a guest's links point. A custom address per event (D-C6, PR 119) replaces this one value.
  const guestOrigin = baseUrl;
  const vars: TemplateVars = {
    ...facts.vars,
    email: registration.email,
    first_name: named ? registration.first_name : "",
    last_name: named ? registration.last_name : "",
    full_name: named ? registration.name : "",
    confirm_url: templateName === "registration-confirm" ? buildConfirmUrl(guestOrigin, facts.slug, registration.id) : "",
  };
  return renderTemplate(
    { subject: template.subjectTemplate, compiledHtml: template.compiledHtmlTemplate },
    vars,
    { baseUrl, customAssetPlaceholders: facts.assetNames },
  );
}
