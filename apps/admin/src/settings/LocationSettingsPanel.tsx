import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  EMPTY_ADDRESS_COMPONENTS,
  LOCATION_LIMITS,
  buildAppleMapsUrl,
  buildGoogleMapsUrl,
} from "@admitto/location";
import { Badge, Button, Card, HintLabel, Notice, useToast } from "@admitto/ui";
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
import { VenueAutocomplete } from "../components/VenueAutocomplete.js";
import { whenShown, useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { AddressComponentsGrid } from "./AddressComponentsGrid.js";
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
};

const ADDRESS_CARD_HINT =
  "Used to show a map, give directions, and check the venue against the event timezone.";
const DIRECTIONS_HINT =
  "How attendees find the entrance, parking, or public transit. Shown with the event location.";
const ACCESSIBILITY_HINT =
  "Step-free access, accessible restrooms, hearing loop, and similar notes for attendees.";

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
      const [location, tiles] = await Promise.all([
        fetchEventLocation(eventId, ac.signal),
        fetchMapTileConfig(ac.signal),
      ]);
      if (ac.signal.aborted) return;
      applyResponse(location);
      setTileConfig(tiles);
      setContactConfigured(tiles.contact_configured);
    } catch {
      if (ac.signal.aborted) return;
      setLoadError("Failed to load location settings.");
      setApiData(null);
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
    setDraftVerified(false);
    setDraft((prev) => ({
      ...prev,
      latitude: null,
      longitude: null,
      formatted_address: "",
      address_components: { ...EMPTY_ADDRESS_COMPONENTS },
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
    setDraft((prev) => ({ ...prev, latitude, longitude }));

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
        ? buildGoogleMapsUrl(lat, lng, label)
        : buildAppleMapsUrl(lat, lng, label);
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

  if (loadError || !apiData || !tileConfig) {
    return (
      <Card title="Address">
        <p role="alert" className="text-error">
          Failed to load location settings.{" "}
          <button
            type="button"
            className="settings-retry-link"
            onClick={() => {
              loadSettings().catch(() => {});
            }}
          >
            Retry
          </button>
        </p>
      </Card>
    );
  }

  const { latitude, longitude } = draft;
  const disabled = isArchived || saving;
  const hasCoordinates = latitude !== null && longitude !== null;
  const timezoneMismatch =
    Boolean(suggestedTimezone) && suggestedTimezone !== eventTimezone;
  const showVerified = draftVerified;

  return (
    <div className="settings-sections">
      <Card
        title={<HintLabel hint={ADDRESS_CARD_HINT}>Address</HintLabel>}
        actions={
          !isArchived && hasCoordinates ? (
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={handleClearLocation}>
              Clear map
            </Button>
          ) : undefined
        }
      >
        <div className="settings-field-stack">
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
              hint="The venue name shown to attendees. Search OpenStreetMap by name or street address - pick a match to set the map. If the venue is missing from the map data, search a nearby street address or drop a pin below, then type the display name here (the pin stays)."
              onChange={(text) => {
                // Keep the map pin and address grid when renaming - OSM often lacks the
                // building POI, so the intended workflow is pin (or street search) + manual
                // venue display name. Clear map / a new suggestion still replace coordinates.
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
                Click the map to drop a pin, or drag an existing pin to adjust it. Editing the venue
                name above keeps the pin - use Clear map to remove it.
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
              <span className="location-map-footer__verified">
                {showVerified ? (
                  <Badge variant="ok">Verified on OpenStreetMap</Badge>
                ) : (
                  <span className="location-map-footer__verified-placeholder" aria-hidden="true" />
                )}
              </span>
              <span className="location-map-footer__coords">
                <i className="ti ti-map-pin" aria-hidden="true" />
                {hasCoordinates ? formatMapCoordinates(latitude!, longitude!) : "-"}
              </span>
            </div>
            <div className="location-map-footer__links">
              <button
                type="button"
                className="location-map-footer__link"
                disabled={!hasCoordinates || isArchived}
                onClick={() => void copyMapLink("google")}
              >
                <i className="ti ti-copy" aria-hidden="true" />
                <span>Copy Google Maps link</span>
              </button>
              <button
                type="button"
                className="location-map-footer__link"
                disabled={!hasCoordinates || isArchived}
                onClick={() => void copyMapLink("apple")}
              >
                <i className="ti ti-copy" aria-hidden="true" />
                <span>Copy Apple Maps link</span>
              </button>
            </div>
          </div>

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
    </div>
  );
}
