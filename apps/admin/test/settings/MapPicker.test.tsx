// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapPicker } from "../../src/settings/MapPicker.js";
import type { MapTileConfigDto } from "../../src/api/types.js";

// jsdom doesn't implement ResizeObserver - MapPicker uses it to fix Leaflet's size once its
// tab panel becomes visible (see MapPicker.tsx's comment on this). Not exercised by these tests.
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

const TILE_CONFIG: MapTileConfigDto = {
  enabled: true,
  tile_url: "https://tile.example/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors",
  max_zoom: 19,
  contact_configured: true,
};

/** jsdom defaults every element's getBoundingClientRect to all-zero, which breaks Leaflet's
 * pixel<->latlng projection - give the map container real dimensions so a simulated click
 * resolves to a real (non-NaN) point. */
function giveContainerSize(container: HTMLElement): void {
  const mapDiv = container.querySelector(".location-map-picker") as HTMLElement;
  mapDiv.getBoundingClientRect = () =>
    ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

describe("MapPicker", () => {
  it("renders an empty world view when no coordinates are set", () => {
    const { container } = render(
      <MapPicker latitude={null} longitude={null} zoom={15} tileConfig={TILE_CONFIG} onPick={() => {}} />,
    );
    expect(container.querySelector(".location-map-picker")).toBeTruthy();
    expect(container.querySelector(".leaflet-marker-icon")).toBeFalsy();
  });

  it("renders a marker when coordinates are set", () => {
    const { container } = render(
      <MapPicker latitude={51.5074} longitude={-0.1278} zoom={15} tileConfig={TILE_CONFIG} onPick={() => {}} />,
    );
    expect(container.querySelector(".leaflet-marker-icon")).toBeTruthy();
  });

  it("calls onPick with a lat/lng pair when the map is clicked", () => {
    const onPick = vi.fn();
    const { container } = render(
      <MapPicker latitude={null} longitude={null} zoom={15} tileConfig={TILE_CONFIG} onPick={onPick} />,
    );
    giveContainerSize(container);
    const mapDiv = container.querySelector(".location-map-picker") as HTMLElement;
    mapDiv.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 200, clientY: 150 }));

    expect(onPick).toHaveBeenCalledTimes(1);
    const [lat, lng] = onPick.mock.calls[0] as [number, number];
    expect(Number.isFinite(lat)).toBe(true);
    expect(Number.isFinite(lng)).toBe(true);
  });

  it("does not call onPick when clicked while disabled", () => {
    const onPick = vi.fn();
    const { container } = render(
      <MapPicker latitude={null} longitude={null} zoom={15} tileConfig={TILE_CONFIG} disabled onPick={onPick} />,
    );
    giveContainerSize(container);
    const mapDiv = container.querySelector(".location-map-picker") as HTMLElement;
    mapDiv.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 200, clientY: 150 }));

    expect(onPick).not.toHaveBeenCalled();
  });

  it("applies the disabled modifier class when disabled", () => {
    const { container } = render(
      <MapPicker latitude={null} longitude={null} zoom={15} tileConfig={TILE_CONFIG} disabled onPick={() => {}} />,
    );
    expect(container.querySelector(".location-map-picker--disabled")).toBeTruthy();
  });

  it("re-renders the marker when coordinates change from null to a value", () => {
    const { container, rerender } = render(
      <MapPicker latitude={null} longitude={null} zoom={15} tileConfig={TILE_CONFIG} onPick={() => {}} />,
    );
    expect(container.querySelector(".leaflet-marker-icon")).toBeFalsy();

    rerender(
      <MapPicker latitude={40.7128} longitude={-74.006} zoom={15} tileConfig={TILE_CONFIG} onPick={() => {}} />,
    );
    expect(container.querySelector(".leaflet-marker-icon")).toBeTruthy();
  });

  it("removes the marker when coordinates change back to null (Clear map location)", () => {
    const { container, rerender } = render(
      <MapPicker latitude={40.7128} longitude={-74.006} zoom={15} tileConfig={TILE_CONFIG} onPick={() => {}} />,
    );
    expect(container.querySelector(".leaflet-marker-icon")).toBeTruthy();

    rerender(<MapPicker latitude={null} longitude={null} zoom={15} tileConfig={TILE_CONFIG} onPick={() => {}} />);
    expect(container.querySelector(".leaflet-marker-icon")).toBeFalsy();
  });
});
