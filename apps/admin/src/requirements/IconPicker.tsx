/** Tabler icon names used for event items — ordered by frequency of use. */
export const ITEM_ICONS: ReadonlyArray<{ name: string; label: string }> = [
  { name: "gift", label: "Gift" },
  { name: "id-badge-2", label: "Badge" },
  { name: "headphones", label: "Headphones" },
  { name: "shirt", label: "T-shirt" },
  { name: "ticket", label: "Ticket" },
  { name: "notebook", label: "Notebook" },
  { name: "cup", label: "Cup" },
  { name: "tool", label: "Tool" },
  { name: "backpack", label: "Backpack" },
  { name: "briefcase", label: "Briefcase" },
  { name: "certificate", label: "Certificate" },
  { name: "crown", label: "Crown (VIP)" },
  { name: "star", label: "Star" },
  { name: "bookmark", label: "Bookmark" },
  { name: "key", label: "Key" },
  { name: "lock", label: "Lock" },
  { name: "map-pin", label: "Location" },
  { name: "calendar", label: "Calendar" },
  { name: "clock", label: "Clock" },
  { name: "camera", label: "Camera" },
  { name: "phone", label: "Phone" },
  { name: "mail", label: "Mail" },
  { name: "printer", label: "Printer" },
  { name: "scan", label: "Scan" },
  { name: "qrcode", label: "QR code" },
  { name: "user", label: "Person" },
  { name: "users", label: "Group" },
  { name: "car", label: "Car (parking)" },
  { name: "bus", label: "Bus (transport)" },
  { name: "pizza", label: "Food" },
  { name: "coffee", label: "Coffee" },
  { name: "glass-full", label: "Drink" },
  { name: "plant", label: "Plant" },
  { name: "ball-football", label: "Ball" },
  { name: "music", label: "Music" },
  { name: "palette", label: "Art" },
  { name: "device-laptop", label: "Laptop" },
  { name: "device-mobile", label: "Mobile" },
];

/** Default Tabler icon when `EventItem.icon` is null — not stored as a string. */
export const DEFAULT_EVENT_ITEM_ICON = "package";

/** Map stored icon to picker value (`null` = default package). */
export function normalizeEventItemIconForForm(icon: string | null | undefined): string | null {
  if (!icon || icon === DEFAULT_EVENT_ITEM_ICON) return null;
  return icon;
}

export interface IconPickerProps {
  value: string | null;
  onChange: (icon: string | null) => void;
}

/** Grid picker for Tabler item icons. */
export function IconPicker({ value, onChange }: Readonly<IconPickerProps>) {
  return (
    <div className="icon-picker">
      <div className="icon-picker__grid" aria-label="Choose icon">
        <button
          type="button"
          className={`icon-picker__item${!value ? " icon-picker__item--selected" : ""}`}
          onClick={() => onChange(null)}
          aria-pressed={!value}
          aria-label="Default icon (package)"
          title="Default (package)"
        >
          <i className={`ti ti-${DEFAULT_EVENT_ITEM_ICON}`} aria-hidden="true" />
        </button>
        {ITEM_ICONS.map((ic) => (
          <button
            key={ic.name}
            type="button"
            className={`icon-picker__item${value === ic.name ? " icon-picker__item--selected" : ""}`}
            onClick={() => onChange(ic.name)}
            aria-pressed={value === ic.name}
            aria-label={ic.label}
            title={ic.label}
          >
            <i className={`ti ti-${ic.name}`} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
