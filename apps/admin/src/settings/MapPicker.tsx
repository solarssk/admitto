import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
import type { MapTileConfigDto } from "../api/types.js";

// Bundlers break Leaflet's default marker icon (it resolves image URLs relative to the CSS
// file); build our own icon from the same bundled assets instead.
const MARKER_ICON = L.icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// No coordinates yet: show the whole world rather than guessing a location.
const FALLBACK_CENTER: L.LatLngTuple = [20, 0];
const FALLBACK_ZOOM = 2;

export interface MapPickerProps {
  latitude: number | null;
  longitude: number | null;
  zoom: number;
  tileConfig: MapTileConfigDto;
  /** Read-only mode (e.g. archived event) - clicking the map or dragging the pin is disabled. */
  disabled?: boolean;
  /** Called with the picked point on map click or pin drag. */
  onPick: (latitude: number, longitude: number) => void;
}

/**
 * Interactive Leaflet map for the Location tab: click anywhere to drop/move the pin, or drag
 * an existing pin. Re-centers when `latitude`/`longitude` change from outside the map itself
 * (loading saved data, picking a geocoding search result) without fighting the user's own pan
 * and zoom once a pin already exists.
 */
export function MapPicker({
  latitude,
  longitude,
  zoom,
  tileConfig,
  disabled = false,
  onPick,
}: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onPickRef = useRef(onPick);
  const disabledRef = useRef(disabled);
  onPickRef.current = onPick;
  disabledRef.current = disabled;

  // Mount the map once. Initial center/tile config intentionally isn't re-applied on prop
  // changes - later position updates go through the effect below instead.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const hasInitialPosition = latitude !== null && longitude !== null;
    const map = L.map(container, {
      center: hasInitialPosition ? [latitude, longitude] : FALLBACK_CENTER,
      zoom: hasInitialPosition ? zoom : FALLBACK_ZOOM,
    });
    L.tileLayer(tileConfig.tile_url, {
      attribution: tileConfig.attribution,
      maxZoom: tileConfig.max_zoom,
    }).addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (disabledRef.current) return;
      onPickRef.current(e.latlng.lat, e.latlng.lng);
    });
    mapRef.current = map;

    // A map created while its tab panel is hidden (display: none) measures 0x0; fix its size
    // once the panel is actually shown, or whenever the container is later resized.
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once map setup, see comment above
  }, []);

  // Sync the pin with the current coordinates. A brand-new pin snaps the view to it (zoomed
  // in); once a pin exists, only pan to follow it so we don't fight the user's own zoom level.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (latitude === null || longitude === null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const latLng: L.LatLngTuple = [latitude, longitude];
    if (markerRef.current) {
      markerRef.current.setLatLng(latLng);
      map.panTo(latLng);
    } else {
      const marker = L.marker(latLng, { icon: MARKER_ICON, draggable: !disabledRef.current });
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        onPickRef.current(pos.lat, pos.lng);
      });
      marker.addTo(map);
      markerRef.current = marker;
      map.setView(latLng, zoom);
    }
  }, [latitude, longitude, zoom]);

  // Keep pin draggability in sync with `disabled` (e.g. the event gets archived mid-edit).
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker?.dragging) return;
    if (disabled) marker.dragging.disable();
    else marker.dragging.enable();
  }, [disabled, latitude, longitude]);

  return (
    <div
      ref={containerRef}
      className={disabled ? "location-map-picker location-map-picker--disabled" : "location-map-picker"}
    />
  );
}
