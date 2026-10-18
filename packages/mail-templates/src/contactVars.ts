import type { PrismaClient } from "@admitto/db";

export interface ContactTemplateVars {
  contact_name: string;
  contact_email: string;
}

/**
 * Who a guest writes to (D-B12): the first event contact with an e-mail address, by `sort_order`;
 * otherwise the organization's support contact (its name, else the organization's own name).
 * Both values are empty when neither exists - a registration mail never invents an address.
 */
export async function resolveEventContactVars(
  eventId: string,
  prisma: PrismaClient,
): Promise<ContactTemplateVars> {
  const contact = await prisma.eventContact.findFirst({
    where: { event_id: eventId, email: { not: null }, NOT: { email: "" } },
    orderBy: [{ sort_order: "asc" }, { created_at: "asc" }, { id: "asc" }],
    select: { name: true, email: true },
  });
  if (contact?.email) {
    return { contact_name: contact.name, contact_email: contact.email };
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      organization: {
        select: { name: true, support_contact_name: true, support_contact_email: true },
      },
    },
  });
  const org = event?.organization;
  if (org?.support_contact_email) {
    return {
      contact_name: org.support_contact_name || org.name,
      contact_email: org.support_contact_email,
    };
  }
  return { contact_name: "", contact_email: "" };
}
