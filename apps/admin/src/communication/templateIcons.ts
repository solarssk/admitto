/** Tabler icon names offered for mail templates - communication/notification themed, distinct
 * from requirements/IconPicker's ITEM_ICONS (physical on-site items). */
export const TEMPLATE_ICONS: ReadonlyArray<{ name: string; label: string }> = [
  { name: "ticket", label: "Ticket" },
  { name: "bell", label: "Reminder" },
  { name: "send", label: "Announcement" },
  { name: "calendar-event", label: "Event day" },
  { name: "calendar-plus", label: "Save the date" },
  { name: "clock", label: "Last call" },
  { name: "alert-triangle", label: "Important" },
  { name: "info-circle", label: "Info" },
  { name: "circle-check", label: "Confirmation" },
  { name: "star", label: "Featured" },
  { name: "gift", label: "Thank you" },
  { name: "map-pin", label: "Venue" },
  { name: "users", label: "Group" },
  { name: "qrcode", label: "Check-in" },
  { name: "wallet", label: "Wallet pass" },
];

/** Default Tabler icon when MailTemplate.icon is null - matches templatePickerOptions' fallback
 * for every real saved template. */
export const DEFAULT_TEMPLATE_ICON = "mail";
