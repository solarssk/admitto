import "./icon-picker.css";

/** One icon the picker offers: the name that is stored, the name a person reads, and, when the stored name is not a Tabler glyph of
 * the same name (`food` is drawn as `tools-kitchen-2`), the glyph that draws it here. */
export interface IconPickerItem {
  name: string;
  label: string;
  tabler?: string;
}

/** Tabler icon names used for event items — ordered by frequency of use. */
export const ITEM_ICONS: ReadonlyArray<IconPickerItem> = [
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
  /** Curated icon list to offer; defaults to ITEM_ICONS (event items). */
  icons?: ReadonlyArray<IconPickerItem>;
  /** Tabler icon shown for the "no selection" cell; defaults to DEFAULT_EVENT_ITEM_ICON. */
  defaultIcon?: string;
  /** What the "no selection" cell is called, for a picker whose empty choice is not "the default icon" ("No icon"). */
  noneLabel?: string;
  /** The id of the text that names the group; left out, the group is named "Choose icon". */
  labelledBy?: string;
  /** The icons take no click (a save is under way). */
  disabled?: boolean;
}

/** Grid picker for Tabler icons, reused across features with different curated lists/defaults
 * (event items, mail templates, the registration form) - the grid/selection behavior is shared, the icon set isn't. The group is a
 * native fieldset, named by the label above it. */
export function IconPicker({
  value,
  onChange,
  icons = ITEM_ICONS,
  defaultIcon = DEFAULT_EVENT_ITEM_ICON,
  noneLabel,
  labelledBy,
  disabled,
}: Readonly<IconPickerProps>) {
  return (
    <fieldset
      className="icon-picker"
      aria-label={labelledBy ? undefined : "Choose icon"}
      aria-labelledby={labelledBy}
    >
      <div className="icon-picker__grid">
        <button
          type="button"
          className={`icon-picker__item${!value ? " icon-picker__item--selected" : ""}`}
          onClick={() => onChange(null)}
          aria-pressed={!value}
          aria-label={noneLabel ?? `Default icon (${defaultIcon})`}
          title={noneLabel ?? `Default (${defaultIcon})`}
          disabled={disabled}
        >
          <i className={`ti ti-${defaultIcon}`} aria-hidden="true" />
        </button>
        {icons.map((ic) => (
          <button
            key={ic.name}
            type="button"
            className={`icon-picker__item${value === ic.name ? " icon-picker__item--selected" : ""}`}
            onClick={() => onChange(ic.name)}
            aria-pressed={value === ic.name}
            aria-label={ic.label}
            title={ic.label}
            disabled={disabled}
          >
            <i className={`ti ti-${ic.tabler ?? ic.name}`} aria-hidden="true" />
          </button>
        ))}
      </div>
    </fieldset>
  );
}
