import type { AddressComponentsDto, GeocodingResultDto } from "../api/types.js";
import {
  EMPTY_ADDRESS_COMPONENTS,
  isAddressComponentsEmpty,
  isAddressComponentsSparse,
  preferNumberedStreet,
  streetLineLooksNumbered,
} from "@admitto/location";
import { reverseGeocoding } from "../api/client.js";

/** Map a geocoding hit onto the Address card grid (structured components, else name-only). */
export function componentsFromResult(result: GeocodingResultDto): AddressComponentsDto {
  if (result.components && !isAddressComponentsEmpty(result.components)) {
    return result.components;
  }
  // Label-only / sparse geocode: keep the grid useful instead of six dashes.
  return {
    ...EMPTY_ADDRESS_COMPONENTS,
    object_name: result.name ?? result.formatted_address,
  };
}

/**
 * Nominatim POI hits often return only `name` + `label` (no street/city in GeocodeJSON).
 * Reverse at the pin fills the address grid from nearby OSM address tags without replacing
 * the venue name the admin just picked.
 *
 * Also re-runs when Street & number is present but has no house number — large amenities
 * (stadiums, hotels) frequently carry street-only tags while reverse finds addr:housenumber.
 */
export async function enrichComponentsFromReverse(
  result: GeocodingResultDto,
  base: AddressComponentsDto,
  onContactConfigured?: (configured: boolean) => void,
): Promise<{ components: AddressComponentsDto; formatted_address: string }> {
  const needsEnrichment =
    isAddressComponentsSparse(base) || !streetLineLooksNumbered(base.street);
  if (!needsEnrichment) {
    return { components: base, formatted_address: result.formatted_address };
  }
  try {
    const res = await reverseGeocoding(result.latitude, result.longitude);
    onContactConfigured?.(res.contact_configured);
    if (!res.result) {
      return { components: base, formatted_address: result.formatted_address };
    }
    const fromReverse = componentsFromResult(res.result);
    const merged = preferNumberedStreet(base, fromReverse);
    const formatted_address =
      !isAddressComponentsSparse(merged) && res.result.formatted_address
        ? res.result.formatted_address
        : result.formatted_address;
    return { components: merged, formatted_address };
  } catch {
    return { components: base, formatted_address: result.formatted_address };
  }
}
