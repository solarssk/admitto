import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Card, Button, Notice, useToast } from "@admitto/ui";
import { LOCATION_LIMITS, buildAppleMapsUrl, buildGoogleMapsUrl, buildOsmUrl } from "@admitto/location";
import { fetchEventLocation, fetchMapTileConfig, saveEventLocation } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventLocationDto, GeocodingResultDto, MapTileConfigDto } from "../api/types.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { VenueAutocomplete } from "../components/VenueAutocomplete.js";
import { whenShown, useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { formatUtcDateTime } from "../utils/event-dates.js";
import { MapPicker } from "./MapPicker.js";
import { SettingsFooter } from "./mailTransportFormParts.js";
import {
  buildEventLocationPatchBody,
  draftFromLocation,
  geocodingProviderLabel,
  isLocationDirty,
  type LocationDraft,
} from "./locationSettingsForm.js";
import "./location-settings.css";

const EMPTY_DRAFT: LocationDraft = {
  venue_name: "",
  formatted_address: "",
  latitude: null,
  longitude: null,
  map_zoom: LOCATION_LIMITS.DEFAULT_ZOOM,
  directions_text: "",
  accessibility_text: "",
};

export type LocationSettingsPanelHandle = {
  save: () => Promise<void>;
  reset: () => void;
};

/** Location tab: address, an interactive Leaflet map (click/drag to set coordinates, or search
 * an address via the server's Nominatim proxy), and directions/accessibility notes. Mirrors
 * EventMailSettingsCard's own load/draft/dirty/saving shape. */
export const LocationSettingsPanel = forwardRef<
  LocationSettingsPanelHandle,
  Readonly<{
    eventId: string;
    isArchived: boolean;
    /** Notified on every change to hasUnsavedChanges, so the hosting page can fold this
     * card's dirty state into its own navigation/unload/destructive-action warnings. */
    onDirtyChange?: (dirty: boolean) => void;
    /** Notified on every change to the in-flight save state, so the page header's hoisted
     * Save button can disable itself and show "Saving…". */
    onSavingChange?: (saving: boolean) => void;
  }>
>(function LocationSettingsPanel({ eventId, isArchived, onDirtyChange, onSavingChange }, ref) {
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

  const [contactConfigured, setContactConfigured] = useState(true);

  const loadAbortRef = useRef<AbortController | null>(null);
  const validationErrorsRef = useRef<HTMLUListElement | null>(null);
  // Set only right after picking a geocoding search result, cleared on any manual pin
  // move/clear - see buildEventLocationPatchBody's doc comment for why this matters.
  const pendingGeocodingProviderRef = useRef<string | null>(null);

  const applyResponse = useCallback((data: EventLocationDto) => {
    const nextDraft = draftFromLocation(data);
    setApiData(data);
    setDraft(nextDraft);
    setSavedDraft(nextDraft);
    pendingGeocodingProviderRef.current = null;
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
    if (!apiData) return;
    const body = buildEventLocationPatchBody(draft, savedDraft, pendingGeocodingProviderRef.current);
    if (Object.keys(body).length === 0) return;
    setSaving(true);
    try {
      const data = await saveEventLocation(eventId, body);
      applyResponse(data);
      addToast("Location saved.", "success");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to save location."), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft(savedDraft);
    pendingGeocodingProviderRef.current = null;
  };

  useImperativeHandle(ref, () => ({ save: handleSave, reset: handleReset }));

  const dirty = isLocationDirty(draft, savedDraft);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  function setCoordinates(latitude: number | null, longitude: number | null) {
    pendingGeocodingProviderRef.current = null;
    setDraft((prev) => ({ ...prev, latitude, longitude }));
  }

  // Clears the address too - a formatted_address with no coordinates has nothing left to
  // anchor it to (no map, no "Located via ..." provenance). The venue name is left alone: it's
  // the display label, not part of what the map/geocoding result described.
  const handleClearLocation = () => {
    pendingGeocodingProviderRef.current = null;
    setDraft((prev) => ({ ...prev, latitude: null, longitude: null, formatted_address: "" }));
  };

  function handleSelectResult(result: GeocodingResultDto) {
    pendingGeocodingProviderRef.current = result.provider;
    setDraft((prev) => ({
      ...prev,
      venue_name: result.name ?? result.formatted_address,
      formatted_address: result.formatted_address,
      latitude: result.latitude,
      longitude: result.longitude,
      map_zoom: LOCATION_LIMITS.DEFAULT_ZOOM,
    }));
  }

  if (loading) {
    return whenShown(
      showLoading,
      <Card title="Location">
        <p>Loading location settings…</p>
      </Card>,
    );
  }

  if (loadError || !apiData || !tileConfig) {
    return (
      <Card title="Location">
        <p role="alert" className="text-error">
          {loadError ?? "Failed to load location settings."}{" "}
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

  return (
    <div className="settings-sections">
      <Card title="Venue">
        <p className="field-hint">
          The venue name shown to attendees. Start typing a name or address to search - pick a
          match to also set the map location below, or keep typing to save free text.
        </p>

        {contactConfigured === false && (
          <Notice
            variant="warning"
            role="alert"
            className="location-address-notice"
            action={
              isSa && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate("/admin/settings?tab=general")}
                >
                  Open instance settings
                </Button>
              )
            }
          >
            No Support contact is configured for this instance. Nominatim&apos;s usage policy asks
            for an identifiable contact for address lookups - they still work, but consider setting
            one in Instance Settings.
          </Notice>
        )}

        <VenueAutocomplete
          id="location-venue-name"
          label="Venue name or address"
          value={draft.venue_name}
          maxLength={LOCATION_LIMITS.VENUE_NAME_MAX_LENGTH}
          disabled={disabled}
          placeholder="e.g. Convention Center, or a full address"
          onChange={(text) => setDraft((prev) => ({ ...prev, venue_name: text }))}
          onSelectResult={handleSelectResult}
          onContactConfigured={setContactConfigured}
        />

        {draft.formatted_address && (
          <p className="field-hint">Address: {draft.formatted_address}</p>
        )}
      </Card>

      <Card title="Map">
        {tileConfig.enabled ? (
          <>
            <MapPicker
              latitude={latitude}
              longitude={longitude}
              zoom={draft.map_zoom}
              tileConfig={tileConfig}
              disabled={isArchived}
              onPick={setCoordinates}
            />
            <p className="field-hint">Click the map to drop a pin, or drag an existing pin to adjust it.</p>
          </>
        ) : (
          <Notice variant="info">
            Map display is disabled for this instance. Venue search above still works and sets
            coordinates, but there is no map to click or drag a pin on.
          </Notice>
        )}

        {latitude !== null && longitude !== null ? (
          <div className="location-map-info">
            <p className="field-hint">
              {latitude.toFixed(6)}, {longitude.toFixed(6)}
            </p>
            {apiData.geocoding_provider && (
              <p className="field-hint">
                Located via {geocodingProviderLabel(apiData.geocoding_provider)}
                {apiData.geocoded_at ? ` on ${formatUtcDateTime(apiData.geocoded_at)}` : ""}.
              </p>
            )}
            <p className="location-map-links">
              <a href={buildGoogleMapsUrl(latitude, longitude)} target="_blank" rel="noopener noreferrer">
                Google Maps
              </a>
              {" · "}
              <a
                href={buildAppleMapsUrl(latitude, longitude, draft.formatted_address)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Apple Maps
              </a>
              {" · "}
              <a href={buildOsmUrl(latitude, longitude, draft.map_zoom)} target="_blank" rel="noopener noreferrer">
                OpenStreetMap
              </a>
            </p>
            {!isArchived && (
              <Button type="button" variant="secondary" size="sm" onClick={handleClearLocation}>
                Clear map location
              </Button>
            )}
          </div>
        ) : (
          <p className="field-hint">No coordinates set yet. Search for an address above, or click the map.</p>
        )}
      </Card>

      <Card title="Directions & accessibility">
        <div className="settings-field-stack">
          <div className="settings-field-group">
            <label className="at-label" htmlFor="location-directions">
              Directions
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
            <p className="field-hint">Optional. Saved with the event, alongside the map.</p>
          </div>
          <div className="settings-field-group">
            <label className="at-label" htmlFor="location-accessibility">
              Accessibility
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
            <p className="field-hint">Optional. Saved with the event, alongside the map.</p>
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
});
