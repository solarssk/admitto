import {
  SYSTEM_TEMPLATE_NAMES,
  isSystemTemplateName,
  systemTemplateLabel,
  type SystemTemplateName,
} from "@admitto/mail-templates/systemTemplates";
import type { MailTemplateListItem } from "../api/types.js";

/** Picker key of the ticket template while the event has no row of its own (it runs on the shared default). */
export const VIRTUAL_TICKET_KEY = "virtual-ticket";

const VIRTUAL_KEY_PREFIX = "virtual-";

/** Picker key of a registration mail while the event has no row of its own, so it runs on the built-in default. */
export function virtualSystemKey(name: SystemTemplateName): string {
  return `${VIRTUAL_KEY_PREFIX}${name}`;
}

/** Whether a picker key stands for a template that has no row yet: the ticket template, or a registration mail, running
 * on the default. */
export function isVirtualKey(key: string): boolean {
  return key === VIRTUAL_TICKET_KEY || virtualSystemName(key) !== null;
}

/** The registration mail a picker key stands for while it has no row, else null (a saved row's key is its id). */
export function virtualSystemName(key: string): SystemTemplateName | null {
  if (!key.startsWith(VIRTUAL_KEY_PREFIX)) return null;
  const name = key.slice(VIRTUAL_KEY_PREFIX.length);
  return isSystemTemplateName(name) ? name : null;
}

/** The registration mail the open picker entry is: a virtual entry, or the saved row of one. Null for any other template. */
export function activeSystemName(
  activeKey: string,
  templates: readonly MailTemplateListItem[],
): SystemTemplateName | null {
  const virtual = virtualSystemName(activeKey);
  if (virtual) return virtual;
  const row = templates.find((t) => t.id === activeKey);
  return row && isSystemTemplateName(row.name) ? row.name : null;
}

/** A Tabler icon for each mail, so the four read apart in the picker. A saved row has no icon of its own to show (its
 * icon is locked, like its name). */
export function systemTemplateIcon(name: SystemTemplateName): string {
  switch (name) {
    case "registration-confirm":
      return "mail-check";
    case "registration-received":
      return "mail-opened";
    case "registration-waitlist":
      return "hourglass";
    case "registration-rejected":
      return "user-x";
  }
}

/** What the mail says and when it goes out, in the words of the organizer (D-D2), and whether the guest's name can be
 * in it (the worker leaves the names out until the address is confirmed or staff decided, `mayShowNames`): shown above
 * the editor of that mail. */
export function systemTemplateDescription(name: SystemTemplateName): string {
  switch (name) {
    case "registration-confirm":
      return "Asks a guest to confirm their email address. The link works for 24 hours. The guest's name stays empty in it.";
    case "registration-received":
      return "Tells a guest their registration is waiting for your decision. A guest who has to confirm their address first gets the confirmation email instead. The guest's name stays empty until the address is confirmed.";
    case "registration-waitlist":
      return "Tells a guest the event is full and their registration is on the waiting list. The guest's name stays empty until the address is confirmed.";
    case "registration-rejected":
      return "Tells a guest their registration was declined. It is sent only if you choose to let the guest know when you decline.";
  }
}

/** True of all four, so said once under the description of the one that is open. */
export const SYSTEM_TEMPLATE_COMMON_NOTE = "Sent automatically, and not listed in the Delivery log.";

export interface SystemPickerOption {
  id: string;
  label: string;
  icon: string;
}

/** The four registration mails as template picker entries, in the order a guest meets them: the saved row of each, else
 * the virtual entry for its built-in default. The name and the icon are the product's, never the stored ones. */
export function systemPickerOptions(templates: readonly MailTemplateListItem[]): SystemPickerOption[] {
  return SYSTEM_TEMPLATE_NAMES.map((name) => ({
    id: templates.find((t) => t.name === name)?.id ?? virtualSystemKey(name),
    label: systemTemplateLabel(name),
    icon: systemTemplateIcon(name),
  }));
}
