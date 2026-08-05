// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalServicesPanel } from "../../src/settings/ExternalServicesPanel.js";
import { renderWithToastAndRouter } from "../test-utils.js";
import type { ExternalServicesResponse } from "../../src/api/types.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchExternalServices: vi.fn(),
    saveWeatherSettings: vi.fn(),
    saveMapsSettings: vi.fn(),
    testWeatherConnection: vi.fn(),
    testMapsConnection: vi.fn(),
  };
});

import {
  ApiError,
  fetchExternalServices,
  saveMapsSettings,
  saveWeatherSettings,
  testMapsConnection,
  testWeatherConnection,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchExternalServices);
const mockSaveWeather = vi.mocked(saveWeatherSettings);
const mockSaveMaps = vi.mocked(saveMapsSettings);
const mockTestWeather = vi.mocked(testWeatherConnection);
const mockTestMaps = vi.mocked(testMapsConnection);

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function sampleResponse(
  overrides: {
    weather?: Partial<ExternalServicesResponse["weather"]>;
    maps?: Partial<ExternalServicesResponse["maps"]>;
  } = {},
): ExternalServicesResponse {
  return {
    weather: {
      enabled: true,
      provider: "metno",
      base_url: "https://api.open-meteo.com",
      api_key: { configured: false, source: "none" },
      attribution: "Weather data by MET Norway",
      attribution_url: "https://www.met.no/en",
      commercial_notice: "Free Open-Meteo is non-commercial.",
      horizon_days: 9,
      contact_configured: true,
      ...overrides.weather,
    },
    maps: {
      enabled: true,
      tile_url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "© OpenStreetMap",
      max_zoom: 19,
      geocoding_provider: "nominatim",
      geocoding_base_url: "https://nominatim.openstreetmap.org",
      ...overrides.maps,
    },
  };
}

beforeEach(() => {
  mockFetch.mockResolvedValue(sampleResponse());
  mockSaveWeather.mockImplementation(async (body) => ({
    ...sampleResponse().weather,
    enabled: body.enabled ?? true,
    provider: body.provider ?? "metno",
    base_url: body.baseUrl ?? sampleResponse().weather.base_url,
  }));
  mockSaveMaps.mockImplementation(async (body) => ({
    ...sampleResponse().maps,
    enabled: body.enabled ?? true,
    tile_url: body.tileUrl ?? sampleResponse().maps.tile_url,
    attribution: body.attribution ?? sampleResponse().maps.attribution,
    max_zoom: body.maxZoom ?? 19,
    geocoding_base_url: body.geocodingBaseUrl ?? sampleResponse().maps.geocoding_base_url,
  }));
  mockTestWeather.mockResolvedValue({ ok: true, message: "Weather reachable." });
  mockTestMaps.mockResolvedValue({ ok: true, message: "Maps reachable." });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

async function renderLoaded() {
  renderWithToastAndRouter(<ExternalServicesPanel />);
  await waitFor(() => {
    expect(document.getElementById("external-weather-provider")).toBeTruthy();
  });
}

describe("ExternalServicesPanel", () => {
  it("shows the loading placeholder once the fetch has taken a moment", () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderWithToastAndRouter(<ExternalServicesPanel />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows operator-safe message when external services fail to load", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToastAndRouter(<ExternalServicesPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    expect(screen.getByText("Could not load external services")).toBeTruthy();
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("reloads after clicking Retry from the load-error state", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "boom"));
    renderWithToastAndRouter(<ExternalServicesPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    mockFetch.mockResolvedValueOnce(sampleResponse());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(document.getElementById("external-weather-provider")).toBeTruthy();
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("warns when MET Norway is on without Support contact", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({ weather: { contact_configured: false } }),
    );
    await renderLoaded();
    expect(screen.getByText(/MET Norway requires an identifiable User-Agent/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Support contact" })).toBeTruthy();
  });

  it("shows Open-Meteo fields after switching provider", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLSelectElement>("external-weather-provider"), {
      target: { value: "openmeteo" },
    });
    expect(document.getElementById("external-weather-base-url")).toBeTruthy();
    expect(document.getElementById("external-weather-api-key")).toBeTruthy();
    expect(screen.getByText(/non-commercial/i)).toBeTruthy();
  });

  it("blocks save when commercial Open-Meteo host has no API key", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLSelectElement>("external-weather-provider"), {
      target: { value: "openmeteo" },
    });
    fireEvent.change(el<HTMLInputElement>("external-weather-base-url"), {
      target: { value: "https://customer-api.open-meteo.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(
        screen.getAllByText("API key is required for customer-api.open-meteo.com.").length,
      ).toBeGreaterThan(0);
    });
    expect(mockSaveWeather).not.toHaveBeenCalled();
  });

  it("blocks save when max zoom is out of range", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-maps-max-zoom"), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Max zoom must be a number between 1 and 22.")).toBeTruthy();
    });
    expect(mockSaveMaps).not.toHaveBeenCalled();
  });

  it("toasts info when Save is clicked with no dirty fields", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toContain("No changes to save.");
    });
    expect(mockSaveWeather).not.toHaveBeenCalled();
    expect(mockSaveMaps).not.toHaveBeenCalled();
  });

  it("saves weather-only dirty changes and toasts success", async () => {
    await renderLoaded();
    fireEvent.click(el<HTMLInputElement>("external-weather-enabled"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toContain("External services saved.");
    });
    expect(mockSaveWeather).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, provider: "metno" }),
    );
    expect(mockSaveMaps).not.toHaveBeenCalled();
  });

  it("saves maps-only dirty changes", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-maps-geocoding-base-url"), {
      target: { value: "https://nominatim.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toContain("External services saved.");
    });
    expect(mockSaveMaps).toHaveBeenCalledWith(
      expect.objectContaining({ geocodingBaseUrl: "https://nominatim.example.com" }),
    );
    expect(mockSaveWeather).not.toHaveBeenCalled();
  });

  it("toasts operator-safe error when weather save fails", async () => {
    mockSaveWeather.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    await renderLoaded();
    fireEvent.click(el<HTMLInputElement>("external-weather-enabled"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Could not save weather settings/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("tests weather connection and toasts the result", async () => {
    await renderLoaded();
    const weatherTestButtons = screen.getAllByRole("button", { name: "Test connection" });
    fireEvent.click(weatherTestButtons[0]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toContain("Weather reachable.");
    });
    expect(mockTestWeather).toHaveBeenCalledWith({ provider: "metno" });
  });

  it("tests maps connection and toasts the result", async () => {
    await renderLoaded();
    const testButtons = screen.getAllByRole("button", { name: "Test connection" });
    fireEvent.click(testButtons[1]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toContain("Maps reachable.");
    });
    expect(mockTestMaps).toHaveBeenCalledWith({
      geocodingBaseUrl: "https://nominatim.openstreetmap.org",
    });
  });

  it("resets dirty drafts when Reset is clicked", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-maps-max-zoom"), { target: { value: "12" } });
    expect(el<HTMLInputElement>("external-maps-max-zoom").value).toBe("12");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(el<HTMLInputElement>("external-maps-max-zoom").value).toBe("19");
  });
});
