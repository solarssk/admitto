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
  /** Called when the admin double-clicks the map or finishes dragging the pin. */
  onPick: (latitude: number, longitude: number) => void;
  /** Called when the operator changes Leaflet zoom (controls or pinch) so draft.map_zoom persists. */
  onZoomChange?: (zoom: number) => void;
}

/**
 * Interactive Leaflet map for the Location tab.
 *
 * Pan and zoom freely without moving the pin. Place or relocate with a **double-click**;
 * fine-tune an existing pin by dragging it. Single-click is intentionally ignored so
 * exploring the basemap does not overwrite the saved venue.
 */
export function MapPicker({
  latitude,
  longitude,
  zoom,
  tileConfig,
  disabled = false,
  onPick,
  onZoomChange,
}: Readonly<MapPickerProps>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onPickRef = useRef(onPick);
  const onZoomChangeRef = useRef(onZoomChange);
  const disabledRef = useRef(disabled);
  /** Last lat/lng we synced onto the marker — used so zoom-only draft updates do not panTo. */
  const syncedCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  onPickRef.current = onPick;
  onZoomChangeRef.current = onZoomChange;
  disabledRef.current = disabled;

  // Mount the map once. Initial center/tile config intentionally isn't re-applied on prop
  // changes - later position updates go through the effect below instead.
  useEffect(() => {
    const container = containerRef.current!;

    const hasInitialPosition = latitude !== null && longitude !== null;
    const map = L.map(container, {
      center: hasInitialPosition ? [latitude, longitude] : FALLBACK_CENTER,
      zoom: hasInitialPosition ? zoom : FALLBACK_ZOOM,
      // Double-click places/moves the pin — keep Leaflet from also zooming in.
      doubleClickZoom: false,
    });
    L.tileLayer(tileConfig.tile_url, {
      attribution: tileConfig.attribution,
      maxZoom: tileConfig.max_zoom,
    }).addTo(map);
    map.on("dblclick", (e: L.LeafletMouseEvent) => {
      if (disabledRef.current) return;
      onPickRef.current(e.latlng.lat, e.latlng.lng);
    });
    map.on("zoomend", () => {
      onZoomChangeRef.current?.(map.getZoom());
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
      syncedCoordsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once map setup, see comment above
  }, []);

  // Sync the pin with the current coordinates. A brand-new pin snaps the view to it (zoomed
  // in). When coordinates change from search/dblclick/drag, pan (or setView if zoom also
  // changed). Zoom-only updates from the draft must not yank the viewport back to the pin.
  useEffect(() => {
    const map = mapRef.current!;

    if (latitude === null || longitude === null) {
      markerRef.current?.remove();
      markerRef.current = null;
      syncedCoordsRef.current = null;
      return;
    }

    const latLng: L.LatLngTuple = [latitude, longitude];
    const prev = syncedCoordsRef.current;
    const coordsChanged = !prev || prev.lat !== latitude || prev.lng !== longitude;
    syncedCoordsRef.current = { lat: latitude, lng: longitude };

    if (markerRef.current) {
      markerRef.current.setLatLng(latLng);
      if (coordsChanged) {
        if (map.getZoom() !== zoom) map.setView(latLng, zoom);
        else map.panTo(latLng);
      }
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
  // Also toggle the disabled CSS class via classList — never via React `className`, which would
  // wipe Leaflet's own classes (`leaflet-container`, …) and drop `overflow: hidden` (map tiles
  // then paint outside the frame after Save flips `saving` → `disabled`).
  useEffect(() => {
    containerRef.current?.classList.toggle("location-map-picker--disabled", disabled);
    const marker = markerRef.current;
    if (!marker?.dragging) return;
    if (disabled) marker.dragging.disable();
    else marker.dragging.enable();
  }, [disabled, latitude, longitude]);

  // Stable className only — Leaflet appends `leaflet-container` etc. on mount; React must not
  // replace the attribute on later renders (see disabled effect above).
  return <div ref={containerRef} className="location-map-picker" />;
}
