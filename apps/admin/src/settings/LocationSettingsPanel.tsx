import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  EMPTY_ADDRESS_COMPONENTS,
  LOCATION_LIMITS,
  resolveAppleMapsUrl,
  resolveGoogleMapsUrl,
} from "@admitto/location";
import { Badge, Button, Card, EmptyState, HintLabel, Input, Notice, useToast } from "@admitto/ui";
import {
  fetchEventLocation,
  fetchMapTileConfig,
  fetchTimezoneForCoordinates,
  reverseGeocoding,
  saveEventLocation,
} from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventLocationDto, GeocodingResultDto, MapTileConfigDto } from "../api/types.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { TimeInput } from "../components/TimeInput.js";
import { VenueAutocomplete } from "../components/VenueAutocomplete.js";
import { whenShown, useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { AddressComponentsGrid } from "./AddressComponentsGrid.js";
import { FixMapsLinkModal } from "./FixMapsLinkModal.js";
import { componentsFromResult, enrichComponentsFromReverse } from "./locationGeocode.js";
import { MapPicker } from "./MapPicker.js";
import { SettingsFooter } from "./mailTransportFormParts.js";
import {
  buildEventLocationPatchBody,
  draftFromLocation,
  isLocationDirty,
  type LocationDraft,
} from "./locationSettingsForm.js";
import { formatMapCoordinates } from "./locationTimezone.js";
import "./location-settings.css";

const EMPTY_DRAFT: LocationDraft = {
  venue_name: "",
  formatted_address: "",
  latitude: null,
  longitude: null,
  map_zoom: LOCATION_LIMITS.DEFAULT_ZOOM,
  directions_text: "",
  accessibility_text: "",
  address_components: { ...EMPTY_ADDRESS_COMPONENTS },
  google_maps_url_override: "",
  apple_maps_url_override: "",
  venue_room: "",
  venue_entrance: "",
  venue_entrance_door: "",
  venue_entrance_gate: "",
  venue_entrance_portal: "",
  venue_phone_number: "",
  venue_place_id: "",
  venue_open_time: "",
  venue_close_time: "",
  doors_open_time: "",
  gates_open_time: "",
  box_office_open_time: "",
  parking_lots_open_time: "",
  fan_zone_open_time: "",
};

const ADDRESS_CARD_HINT =
  "Venue, map pin, and attendee-facing address.";
const ADDRESS_CARD_INTRO =
  "Search for a venue or set its pin on the map.";
const DIRECTIONS_HINT =
  "Arrival details shown with the event location.";
const ACCESSIBILITY_HINT =
  "Accessibility details shown with the event location.";
const ACCESS_POINTS_HINT =
  "Venue and entrance details for this event.";
const ACCESS_POINTS_INTRO =
  "General venue and access details, not specific to Wallet. Today they're used once mapped to a field in Event Settings → Wallet.";
const OPENING_HOURS_INTRO = "All optional - fill in only the ones that apply to this event.";

/** Used when map-tile config cannot be loaded. Keeps venue/notes editable without a MapPicker. */
const MAPS_UNAVAILABLE_FALLBACK: MapTileConfigDto = {
  enabled: false,
  tile_url: "",
  attribution: "",
  max_zoom: LOCATION_LIMITS.DEFAULT_ZOOM,
  contact_configured: true,
};

/** Location tab: venue search, interactive map, structured address grid, and
 * directions/accessibility notes. */
export function LocationSettingsPanel({
  eventId,
  isArchived,
  eventTimezone,
  onDirtyChange,
  onSavingChange,
  onLocationSaved,
  onApplyTimezone,
}: Readonly<{
  eventId: string;
  isArchived: boolean;
  eventTimezone: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  /** Called after a successful location save so the shell can refresh sidebar `event.location`. */
  onLocationSaved?: () => Promise<void> | void;
  /** Apply a suggested IANA timezone from the map pin onto the event (General tab field). */
  onApplyTimezone?: (timezone: string) => Promise<void> | void;
}>) {
  const { addToast } = useToast();
  const { assignments } = useAuth();
  const isSa = isSuperadmin(assignments);
  const navigate = useNavigate();

  const [apiData, setApiData] = useState<EventLocationDto | null>(null);
  const [tileConfig, setTileConfig] = useState<MapTileConfigDto | null>(null);
  const [draft, setDraft] = useState<LocationDraft>(EMPTY_DRAFT);
  const [savedDraft, setSavedDraft] = useState<LocationDraft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const showLoading = useDelayedLoading(loading);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [applyingTimezone, setApplyingTimezone] = useState(false);

  const [contactConfigured, setContactConfigured] = useState(true);
  /** Draft-side geocoding provenance (search/reverse) until the next save clears or confirms it. */
  const [draftVerified, setDraftVerified] = useState(false);
  const [suggestedTimezone, setSuggestedTimezone] = useState<string | null>(null);
  const [fixLinksOpen, setFixLinksOpen] = useState(false);
  const [lookupResetKey, setLookupResetKey] = useState(0);

  const loadAbortRef = useRef<AbortController | null>(null);
  const reverseSeqRef = useRef(0);
  const validationErrorsRef = useRef<HTMLUListElement | null>(null);
  const pendingGeocodingProviderRef = useRef<string | null>(null);

  const applyResponse = useCallback((data: EventLocationDto) => {
    const nextDraft = draftFromLocation(data);
    setApiData(data);
    setDraft(nextDraft);
    setSavedDraft(nextDraft);
    pendingGeocodingProviderRef.current = null;
    setDraftVerified(Boolean(data.geocoding_provider));
  }, []);

  const loadSettings = useCallback(async () => {
    loadAbortRef.current?.abort();
    const ac = new AbortController();
    loadAbortRef.current = ac;
    setLoading(true);
    setLoadError(null);
    try {
      // Location is required for editing. Map tiles are optional: a tile-config
      // failure must not hide venue search or Directions/Accessibility (#808).
      // Fetch both concurrently; only the tile promise falls back when it fails.
      const [locationResult, tilesResult] = await Promise.allSettled([
        fetchEventLocation(eventId, ac.signal),
        fetchMapTileConfig(ac.signal),
      ]);
      if (ac.signal.aborted) return;

      if (locationResult.status === "rejected") {
        setLoadError("Could not load location settings.");
        setApiData(null);
        setTileConfig(null);
        return;
      }

      applyResponse(locationResult.value);

      const tiles =
        tilesResult.status === "fulfilled" ? tilesResult.value : MAPS_UNAVAILABLE_FALLBACK;
      setTileConfig(tiles);
      setContactConfigured(tiles.contact_configured);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [eventId, applyResponse]);

  useEffect(() => {
    loadSettings().catch(() => {});
    return () => loadAbortRef.current?.abort();
  }, [loadSettings]);

  const handleSave = async () => {
    // Save controls only render after a successful load (apiData is set).
    const body = buildEventLocationPatchBody(draft, savedDraft, pendingGeocodingProviderRef.current);
    if (Object.keys(body).length === 0) return;
    setSaving(true);
    try {
      const data = await saveEventLocation(eventId, body);
      applyResponse(data);
      addToast("Location saved.", "success");
      await onLocationSaved?.();
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to save location."), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft(savedDraft);
    pendingGeocodingProviderRef.current = null;
    setDraftVerified(Boolean(apiData?.geocoding_provider));
  };

  const dirty = isLocationDirty(draft, savedDraft);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  useEffect(() => {
    if (draft.latitude === null || draft.longitude === null) {
      setSuggestedTimezone(null);
      return;
    }
    const ac = new AbortController();
    void fetchTimezoneForCoordinates(draft.latitude, draft.longitude, ac.signal)
      .then((res) => {
        if (!ac.signal.aborted) setSuggestedTimezone(res.timezone);
      })
      .catch(() => {
        // Abort or transient API failure — keep the previous suggestion rather than flashing
        // the notice away mid-drag; clear only when the pin itself is cleared above.
        if (!ac.signal.aborted) setSuggestedTimezone(null);
      });
    return () => {
      ac.abort();
    };
  }, [draft.latitude, draft.longitude]);

  const handleClearLocation = () => {
    reverseSeqRef.current += 1;
    pendingGeocodingProviderRef.current = null;
    setLookupResetKey((key) => key + 1);
    setDraftVerified(false);
    setDraft((prev) => ({
      ...prev,
      latitude: null,
      longitude: null,
      formatted_address: "",
      address_components: { ...EMPTY_ADDRESS_COMPONENTS },
      google_maps_url_override: "",
      apple_maps_url_override: "",
    }));
  };

  /**
   * Nominatim POI hits often return only `name` + `label` (no street/city in GeocodeJSON).
   * Reverse at the pin fills the address grid from nearby OSM address tags without replacing
   * the venue name the admin just picked.
   */
  async function applyGeocodingResult(result: GeocodingResultDto) {
    const seq = ++reverseSeqRef.current;
    pendingGeocodingProviderRef.current = result.provider;
    setDraftVerified(true);
    const baseComponents = componentsFromResult(result);
    // Apply the search hit immediately so Save during reverse enrichment persists the pin
    // the admin just picked, not the previous typed query / map state.
    setDraft((prev) => ({
      ...prev,
      venue_name: result.name ?? result.formatted_address,
      formatted_address: result.formatted_address,
      latitude: result.latitude,
      longitude: result.longitude,
      map_zoom: LOCATION_LIMITS.DEFAULT_ZOOM,
      address_components: baseComponents,
      // New pin/venue invalidates pasted Maps links for the previous place.
      google_maps_url_override: "",
      apple_maps_url_override: "",
    }));
    const { components, formatted_address } = await enrichComponentsFromReverse(
      result,
      baseComponents,
      setContactConfigured,
    );
    if (seq !== reverseSeqRef.current) return;
    setDraft((prev) => ({
      ...prev,
      formatted_address,
      address_components: components,
    }));
  }

  function handleSelectResult(result: GeocodingResultDto) {
    void applyGeocodingResult(result);
  }

  /** Rule B: always update address + coords from reverse; fill venue_name only when empty. */
  async function handleMapPick(latitude: number, longitude: number) {
    const seq = ++reverseSeqRef.current;
    // Manual pin move invalidates prior geocode provenance until reverse succeeds.
    pendingGeocodingProviderRef.current = null;
    setLookupResetKey((key) => key + 1);
    // Clear Maps overrides immediately so Copy / Notice cannot keep the previous place's links
    // while reverse geocode is still in flight.
    setDraft((prev) => ({
      ...prev,
      latitude,
      longitude,
      google_maps_url_override: "",
      apple_maps_url_override: "",
    }));

    try {
      const res = await reverseGeocoding(latitude, longitude);
      if (seq !== reverseSeqRef.current) return;
      setContactConfigured(res.contact_configured);
      if (!res.result) {
        // New pin with no OSM coverage must not keep the previous address/grid.
        setDraftVerified(false);
        setDraft((prev) => ({
          ...prev,
          latitude,
          longitude,
          formatted_address: "",
          address_components: { ...EMPTY_ADDRESS_COMPONENTS },
          google_maps_url_override: "",
          apple_maps_url_override: "",
        }));
        return;
      }
      const result = res.result;
      pendingGeocodingProviderRef.current = result.provider;
      setDraftVerified(true);
      setDraft((prev) => ({
        ...prev,
        latitude,
        longitude,
        formatted_address: result.formatted_address,
        venue_name: prev.venue_name.trim()
          ? prev.venue_name
          : (result.name ?? result.formatted_address),
        map_zoom: prev.map_zoom || LOCATION_LIMITS.DEFAULT_ZOOM,
        address_components: componentsFromResult(result),
        google_maps_url_override: "",
        apple_maps_url_override: "",
      }));
    } catch {
      // Coords already applied — a failed reverse must not undo the pin the admin placed.
      // Clear address-derived fields so save cannot pair new coords with a stale address.
      if (seq !== reverseSeqRef.current) return;
      setDraftVerified(false);
      setDraft((prev) => ({
        ...prev,
        latitude,
        longitude,
        formatted_address: "",
        address_components: { ...EMPTY_ADDRESS_COMPONENTS },
        google_maps_url_override: "",
        apple_maps_url_override: "",
      }));
    }
  }

  async function copyMapLink(kind: "google" | "apple") {
    // Buttons are disabled when coordinates are missing.
    const lat = draft.latitude!;
    const lng = draft.longitude!;
    const label = draft.venue_name.trim() || draft.formatted_address.trim() || null;
    const url =
      kind === "google"
        ? resolveGoogleMapsUrl(lat, lng, label, draft.google_maps_url_override)
        : resolveAppleMapsUrl(lat, lng, label, draft.apple_maps_url_override);
    try {
      await navigator.clipboard.writeText(url);
      addToast(`${kind === "google" ? "Google Maps" : "Apple Maps"} link copied.`, "success");
    } catch {
      addToast("Could not copy link.", "error");
    }
  }

  async function handleApplyTimezone(suggested: string) {
    // Button only renders when onApplyTimezone is provided.
    setApplyingTimezone(true);
    try {
      await onApplyTimezone!(suggested);
      addToast(`Event timezone set to ${suggested}.`, "success");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to update timezone."), "error");
    } finally {
      setApplyingTimezone(false);
    }
  }

  if (loading) {
    return whenShown(
      showLoading,
      <Card title="Address">
        <p>Loading location settings…</p>
      </Card>,
    );
  }

  if (loadError) {
    return (
      <Card title="Address">
        <EmptyState
          title="Could not load location settings"
          description={loadError}
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                loadSettings().catch(() => {});
              }}
            >
              Retry
            </Button>
          }
        />
      </Card>
    );
  }

  // Successful load always populates both; failures always set loadError above.
  /* v8 ignore if */
  if (!apiData || !tileConfig) return null;

  const { latitude, longitude } = draft;
  const disabled = isArchived || saving;
  const hasCoordinates = latitude !== null && longitude !== null;
  const hasMapsOverride =
    draft.google_maps_url_override.trim().length > 0 ||
    draft.apple_maps_url_override.trim().length > 0;
  const timezoneMismatch =
    Boolean(suggestedTimezone) && suggestedTimezone !== eventTimezone;
  const showVerified = draftVerified;
  let provenanceBadge: ReactNode;
  if (!hasCoordinates) {
    provenanceBadge = (
      <Badge variant="neutral" outline>
        Not filled
      </Badge>
    );
  } else if (showVerified) {
    provenanceBadge = <Badge variant="ok">From OpenStreetMap</Badge>;
  } else {
    provenanceBadge = <Badge variant="neutral">Set manually</Badge>;
  }

  return (
    <div className="settings-sections">
      <Card
        title={<HintLabel hint={ADDRESS_CARD_HINT}>Address</HintLabel>}
        actions={
          !isArchived && hasCoordinates ? (
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={handleClearLocation}>
              Remove pin
            </Button>
          ) : undefined
        }
      >
        <div className="settings-field-stack">
          <p className="settings-card-intro">{ADDRESS_CARD_INTRO}</p>
          {contactConfigured === false && (
            <Notice
              variant="warning"
              role="alert"
              className="location-contact-notice"
              action={
                isSa && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate("/admin/settings?tab=general")}
                  >
                    Open organisation settings
                  </Button>
                )
              }
            >
              {isSa ? (
                <>
                  No Support contact is configured for this organisation. Nominatim&apos;s usage
                  policy asks for an identifiable contact for address lookups - they still work. Set
                  one in Organisation settings → General (Support contact).
                </>
              ) : (
                <>
                  No Support contact is configured for this organisation. Nominatim&apos;s usage
                  policy asks for an identifiable contact for address lookups - they still work. Ask
                  a superadmin to set one in Organisation settings → General.
                </>
              )}
            </Notice>
          )}

          <div className="settings-field-group">
            <VenueAutocomplete
              id="location-venue-name"
              label="Venue name or address"
              value={draft.venue_name}
              maxLength={LOCATION_LIMITS.VENUE_NAME_MAX_LENGTH}
              disabled={disabled}
              placeholder="e.g. Convention Center, or a full address"
              hint="Search by venue or address, then choose a match to set the pin. You can also set a pin on the map and enter the venue name here."
              showFindButton={false}
              lookupResetKey={lookupResetKey}
              onChange={(text) => {
                // Keep the map pin and address grid when renaming - OSM often lacks the
                // building POI, so the intended workflow is pin (or street search) + manual
                // venue display name. Remove pin / a new suggestion still replace coordinates.
                // Verified badge clears because the free-text name is no longer an OSM pick.
                // Sync object_name so Getting there / {{event_address}} do not keep a stale POI.
                reverseSeqRef.current += 1;
                pendingGeocodingProviderRef.current = null;
                setDraftVerified(false);
                setDraft((prev) => ({
                  ...prev,
                  venue_name: text,
                  address_components: {
                    ...prev.address_components,
                    object_name: text.trim() || null,
                  },
                }));
              }}
              onSelectResult={handleSelectResult}
              onContactConfigured={setContactConfigured}
            />
          </div>

          {tileConfig.enabled ? (
            <div className="settings-field-group">
              <MapPicker
                latitude={latitude}
                longitude={longitude}
                zoom={draft.map_zoom}
                tileConfig={tileConfig}
                disabled={disabled}
                onPick={(lat, lng) => {
                  void handleMapPick(lat, lng);
                }}
                onZoomChange={(nextZoom) => {
                  setDraft((prev) => (prev.map_zoom === nextZoom ? prev : { ...prev, map_zoom: nextZoom }));
                }}
              />
              <p className="field-hint">
                Double-click to place or move the pin. Drag to adjust. Remove pin clears coordinates
                and address fields; the venue name stays.
              </p>
            </div>
          ) : (
            <Notice variant="info">
              Map display is disabled for this instance. Venue search above still works and sets
              coordinates, but there is no map to click or drag a pin on.
            </Notice>
          )}

          <AddressComponentsGrid components={draft.address_components} />

          <div className="location-map-footer">
            <div className="location-map-footer__meta">
              <span className="location-map-footer__verified">{provenanceBadge}</span>
              <span className="location-map-footer__coords">
                <i className="ti ti-map-pin" aria-hidden="true" />
                {hasCoordinates ? formatMapCoordinates(latitude!, longitude!) : "-"}
              </span>
            </div>
            <div className="location-map-footer__links">
              <button
                type="button"
                className="location-map-footer__link location-map-footer__link--copy"
                disabled={!hasCoordinates || isArchived}
                onClick={() => void copyMapLink("google")}
              >
                <i className="ti ti-copy" aria-hidden="true" />
                <span>Copy Google Maps link</span>
              </button>
              <button
                type="button"
                className="location-map-footer__link location-map-footer__link--copy"
                disabled={!hasCoordinates || isArchived}
                onClick={() => void copyMapLink("apple")}
              >
                <i className="ti ti-copy" aria-hidden="true" />
                <span>Copy Apple Maps link</span>
              </button>
              <button
                type="button"
                className="location-map-footer__link location-map-footer__link--fix"
                disabled={!hasCoordinates || isArchived || saving}
                onClick={() => setFixLinksOpen(true)}
              >
                <i className="ti ti-link-off" aria-hidden="true" />
                <span>Pin wrong? Fix link</span>
              </button>
            </div>
          </div>
          {hasMapsOverride && (
            <Notice
              variant="highlight"
              icon="link"
              role="status"
              action={
                !isArchived && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={saving}
                    onClick={() => {
                      setDraft((prev) => ({
                        ...prev,
                        google_maps_url_override: "",
                        apple_maps_url_override: "",
                      }));
                    }}
                  >
                    Remove override
                  </Button>
                )
              }
            >
              Using a manually entered link instead of the pin-built Google/Apple Maps URL.
            </Notice>
          )}

          {timezoneMismatch && suggestedTimezone && (
            <Notice
              variant="info"
              icon="clock"
              role="status"
              action={
                !isArchived &&
                onApplyTimezone && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={applyingTimezone || saving}
                    onClick={() => void handleApplyTimezone(suggestedTimezone)}
                  >
                    Use
                  </Button>
                )
              }
            >
              This address seems to be in <strong>{suggestedTimezone}</strong>. The event&apos;s time
              zone (General tab) is set to <strong>{eventTimezone}</strong>.
            </Notice>
          )}
        </div>
      </Card>

      <Card title={<HintLabel hint={DIRECTIONS_HINT}>Directions & accessibility</HintLabel>}>
        <div className="settings-field-stack">
          <div className="settings-field-group">
            <label className="at-label" htmlFor="location-directions">
              <HintLabel hint={DIRECTIONS_HINT}>Directions</HintLabel>
            </label>
            <textarea
              id="location-directions"
              className="location-textarea"
              value={draft.directions_text}
              maxLength={LOCATION_LIMITS.TEXT_MAX_LENGTH}
              rows={4}
              disabled={disabled}
              placeholder="How to find the entrance, parking, public transit…"
              onChange={(e) => setDraft((prev) => ({ ...prev, directions_text: e.target.value }))}
            />
          </div>
          <div className="settings-field-group">
            <label className="at-label" htmlFor="location-accessibility">
              <HintLabel hint={ACCESSIBILITY_HINT}>Accessibility</HintLabel>
            </label>
            <textarea
              id="location-accessibility"
              className="location-textarea"
              value={draft.accessibility_text}
              maxLength={LOCATION_LIMITS.TEXT_MAX_LENGTH}
              rows={4}
              disabled={disabled}
              placeholder="Step-free access, accessible restrooms, hearing loop…"
              onChange={(e) => setDraft((prev) => ({ ...prev, accessibility_text: e.target.value }))}
            />
          </div>
        </div>
      </Card>

      <Card title={<HintLabel hint={ACCESS_POINTS_HINT}>Venue access details</HintLabel>}>
        <div className="settings-field-stack">
          <p className="settings-card-intro">{ACCESS_POINTS_INTRO}</p>

          <div className="settings-field-row">
            <Input
              label="Venue room"
              value={draft.venue_room}
              disabled={disabled}
              maxLength={LOCATION_LIMITS.SHORT_TEXT_MAX_LENGTH}
              placeholder="e.g. Conference Hall B"
              hint="The hall or room attendees enter, if any."
              onChange={(e) => setDraft((prev) => ({ ...prev, venue_room: e.target.value }))}
            />
            <Input
              label="Venue entrance"
              value={draft.venue_entrance}
              disabled={disabled}
              maxLength={LOCATION_LIMITS.SHORT_TEXT_MAX_LENGTH}
              placeholder="e.g. Main entrance"
              hint="Which entrance to use, if there's more than one."
              onChange={(e) => setDraft((prev) => ({ ...prev, venue_entrance: e.target.value }))}
            />
          </div>

          <div className="settings-field-row settings-field-row--3">
            <Input
              label="Entrance door"
              value={draft.venue_entrance_door}
              disabled={disabled}
              maxLength={LOCATION_LIMITS.SHORT_TEXT_MAX_LENGTH}
              placeholder="e.g. Door 3"
              hint="A specific numbered door."
              onChange={(e) => setDraft((prev) => ({ ...prev, venue_entrance_door: e.target.value }))}
            />
            <Input
              label="Entrance gate"
              value={draft.venue_entrance_gate}
              disabled={disabled}
              maxLength={LOCATION_LIMITS.SHORT_TEXT_MAX_LENGTH}
              placeholder="e.g. Gate B"
              hint="A specific numbered gate."
              onChange={(e) => setDraft((prev) => ({ ...prev, venue_entrance_gate: e.target.value }))}
            />
            <Input
              label="Entrance portal"
              value={draft.venue_entrance_portal}
              disabled={disabled}
              maxLength={LOCATION_LIMITS.SHORT_TEXT_MAX_LENGTH}
              placeholder="e.g. North Portal"
              hint="A named entry, large venues only."
              onChange={(e) => setDraft((prev) => ({ ...prev, venue_entrance_portal: e.target.value }))}
            />
          </div>

          <div className="settings-field-row">
            <Input
              label="Venue phone number"
              value={draft.venue_phone_number}
              disabled={disabled}
              maxLength={LOCATION_LIMITS.SHORT_TEXT_MAX_LENGTH}
              placeholder="e.g. +91 80 4252 1000"
              hint="The venue's own public number, not yours."
              onChange={(e) => setDraft((prev) => ({ ...prev, venue_phone_number: e.target.value }))}
            />
            <div className="settings-field-group">
              <Input
                label="Venue Place ID"
                value={draft.venue_place_id}
                disabled={disabled}
                maxLength={LOCATION_LIMITS.SHORT_TEXT_MAX_LENGTH}
                placeholder="e.g. I4CCAB9B9CD77B6BA"
                onChange={(e) => setDraft((prev) => ({ ...prev, venue_place_id: e.target.value }))}
              />
              <span className="at-hint">
                Optional - search your venue on Apple's{" "}
                <a href="https://developer.apple.com/maps/place-id-lookup/" target="_blank" rel="noopener noreferrer">
                  Place ID Lookup
                </a>{" "}
                tool.
              </span>
            </div>
          </div>

          <details className="disclosure">
            <summary className="disclosure__summary">
              <i className="ti ti-chevron-right" aria-hidden="true" /> Opening hours
            </summary>
            <div className="disclosure__body">
              <div className="settings-field-stack">
                <p className="settings-card-intro">{OPENING_HOURS_INTRO}</p>
                <div className="settings-field-row settings-field-row--3">
                  <TimeInput
                    label="Venue opens"
                    value={draft.venue_open_time}
                    disabled={disabled}
                    hint="When the venue opens to the public."
                    onChange={(value) => setDraft((prev) => ({ ...prev, venue_open_time: value }))}
                  />
                  <TimeInput
                    label="Venue closes"
                    value={draft.venue_close_time}
                    disabled={disabled}
                    hint="When the venue closes to the public."
                    onChange={(value) => setDraft((prev) => ({ ...prev, venue_close_time: value }))}
                  />
                  <TimeInput
                    label="Doors open"
                    value={draft.doors_open_time}
                    disabled={disabled}
                    hint="When attendees are let into the building."
                    onChange={(value) => setDraft((prev) => ({ ...prev, doors_open_time: value }))}
                  />
                </div>
                <div className="settings-field-row settings-field-row--3">
                  <TimeInput
                    label="Gates open"
                    value={draft.gates_open_time}
                    disabled={disabled}
                    hint="When entry gates open, for open-air venues."
                    onChange={(value) => setDraft((prev) => ({ ...prev, gates_open_time: value }))}
                  />
                  <TimeInput
                    label="Box office opens"
                    value={draft.box_office_open_time}
                    disabled={disabled}
                    hint="When on-site ticket sales open."
                    onChange={(value) => setDraft((prev) => ({ ...prev, box_office_open_time: value }))}
                  />
                  <TimeInput
                    label="Parking lots open"
                    value={draft.parking_lots_open_time}
                    disabled={disabled}
                    hint="When parking becomes available."
                    onChange={(value) => setDraft((prev) => ({ ...prev, parking_lots_open_time: value }))}
                  />
                </div>
                <div className="settings-field-row settings-field-row--3">
                  <TimeInput
                    label="Fan zone opens"
                    value={draft.fan_zone_open_time}
                    disabled={disabled}
                    hint="A fan activity area outside the main venue, if this event has one."
                    onChange={(value) => setDraft((prev) => ({ ...prev, fan_zone_open_time: value }))}
                  />
                </div>
              </div>
            </div>
          </details>
        </div>
      </Card>

      {isArchived ? (
        <p className="field-hint event-settings-archived-note">
          This event is archived - location settings cannot be changed.
        </p>
      ) : (
        <SettingsFooter
          validationErrors={[]}
          validationErrorsRef={validationErrorsRef}
          hasUnsavedChanges={dirty}
          saving={saving}
          onReset={handleReset}
          onSave={() => void handleSave()}
        />
      )}

      <FixMapsLinkModal
        open={fixLinksOpen}
        initial={{
          google_maps_url_override: draft.google_maps_url_override,
          apple_maps_url_override: draft.apple_maps_url_override,
        }}
        onClose={() => setFixLinksOpen(false)}
        onApply={(values) => {
          setDraft((prev) => ({
            ...prev,
            google_maps_url_override: values.google_maps_url_override,
            apple_maps_url_override: values.apple_maps_url_override,
          }));
        }}
      />
    </div>
  );
}
