import type { AddressComponents } from "@admitto/location";

const CELLS: ReadonlyArray<{
  key: keyof AddressComponents;
  label: string;
  icon: string;
}> = [
  { key: "object_name", label: "Object name", icon: "ti-building" },
  { key: "street", label: "Street & number", icon: "ti-road" },
  { key: "postcode", label: "Postal code", icon: "ti-mail" },
  { key: "city", label: "City", icon: "ti-building-community" },
  { key: "region", label: "Voivodeship / region", icon: "ti-map-2" },
  { key: "country", label: "Country", icon: "ti-flag" },
];

/** Always-visible 2-column address grid. Empty fields show muted "Not filled" text. */
export function AddressComponentsGrid({
  components,
}: Readonly<{ components: AddressComponents }>) {
  return (
    <dl className="location-address-grid" aria-label="Address details">
      {CELLS.map(({ key, label, icon }) => {
        const value = components[key]?.trim();
        return (
          <div key={key} className="location-address-grid__cell">
            <dt className="location-address-grid__label">
              <i className={`ti ${icon}`} aria-hidden="true" />
              {label}
            </dt>
            <dd className="location-address-grid__value">
              {value || <span className="location-address-grid__empty">Not filled</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
