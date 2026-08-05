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

  it("saves Open-Meteo draft with baseUrl and typed API key", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLSelectElement>("external-weather-provider"), {
      target: { value: "openmeteo" },
    });
    fireEvent.change(el<HTMLInputElement>("external-weather-base-url"), {
      target: { value: "https://api.open-meteo.com" },
    });
    fireEvent.change(el<HTMLInputElement>("external-weather-api-key"), {
      target: { value: "org-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSaveWeather).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "openmeteo",
          baseUrl: "https://api.open-meteo.com",
          apiKey: "org-token",
        }),
      );
    });
  });

  it("saves with clearApiKey when Clear organisation API key is checked", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({
        weather: {
          ...sampleResponse().weather,
          provider: "openmeteo",
          api_key: { configured: true, source: "organization" },
        },
      }),
    );
    await renderLoaded();
    fireEvent.change(el<HTMLSelectElement>("external-weather-provider"), {
      target: { value: "openmeteo" },
    });
    fireEvent.click(el<HTMLInputElement>("external-weather-clear-api-key"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSaveWeather).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "openmeteo", apiKey: "" }),
      );
    });
  });

  it("blocks save when tile URL lacks {z}/{x}/{y}", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-maps-tile-url"), {
      target: { value: "https://tiles.example.com/no-placeholders.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Tile URL should include {z}/{x}/{y} placeholders.")).toBeTruthy();
    });
    expect(mockSaveMaps).not.toHaveBeenCalled();
  });

  it("toasts maps-only save failure without leaking ApiError.message", async () => {
    mockSaveMaps.mockRejectedValueOnce(new ApiError(500, "secret_maps"));
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-maps-geocoding-base-url"), {
      target: { value: "https://nominatim.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Could not save maps settings/);
    });
    expect(screen.queryByText("secret_maps")).toBeNull();
  });

  it("toasts weather test failure from provider response", async () => {
    mockTestWeather.mockResolvedValueOnce({ ok: false, error: "Provider unreachable." });
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[0]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toContain("Provider unreachable.");
    });
  });

  it("toasts operator-safe error when weather test throws", async () => {
    mockTestWeather.mockRejectedValueOnce(new ApiError(500, "secret_probe"));
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[0]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Could not test the weather connection/,
      );
    });
    expect(screen.queryByText("secret_probe")).toBeNull();
  });

  it("toasts maps test failure", async () => {
    mockTestMaps.mockResolvedValueOnce({ ok: false, error: "Nominatim down." });
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[1]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toContain("Nominatim down.");
    });
  });

  it("maps machine probe error codes to operator-safe toast copy", async () => {
    mockTestWeather.mockResolvedValueOnce({ ok: false, error: "invalid_base_url" });
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[0]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Weather base URL must be a valid public http\(s\) URL/,
      );
    });
    expect(screen.queryByText("invalid_base_url")).toBeNull();
  });

  it("saves both weather and maps when both dirty", async () => {
    await renderLoaded();
    fireEvent.click(el<HTMLInputElement>("external-weather-enabled"));
    fireEvent.change(el<HTMLInputElement>("external-maps-geocoding-base-url"), {
      target: { value: "https://nominatim.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSaveWeather).toHaveBeenCalled();
      expect(mockSaveMaps).toHaveBeenCalled();
    });
  });

  it("tests Open-Meteo connection with draft base URL and key", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLSelectElement>("external-weather-provider"), {
      target: { value: "openmeteo" },
    });
    fireEvent.change(el<HTMLInputElement>("external-weather-base-url"), {
      target: { value: "https://api.open-meteo.com" },
    });
    fireEvent.change(el<HTMLInputElement>("external-weather-api-key"), {
      target: { value: "probe-key" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[0]!);
    await waitFor(() => {
      expect(mockTestWeather).toHaveBeenCalledWith({
        provider: "openmeteo",
        baseUrl: "https://api.open-meteo.com",
        apiKey: "probe-key",
      });
    });
  });

  it("toasts both operator-safe messages when weather and maps saves fail", async () => {
    mockSaveWeather.mockRejectedValueOnce(new ApiError(500, "wx_secret"));
    mockSaveMaps.mockRejectedValueOnce(new ApiError(500, "maps_secret"));
    await renderLoaded();
    fireEvent.click(el<HTMLInputElement>("external-weather-enabled"));
    fireEvent.change(el<HTMLInputElement>("external-maps-geocoding-base-url"), {
      target: { value: "https://nominatim.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const toast = screen.getByTestId("at-toast").textContent ?? "";
      expect(toast).toMatch(/Could not save weather settings/);
      expect(toast).toMatch(/Could not save maps settings/);
    });
    expect(screen.queryByText("wx_secret")).toBeNull();
    expect(screen.queryByText("maps_secret")).toBeNull();
  });

  it("uses Connected. fallback when weather test omits message", async () => {
    mockTestWeather.mockResolvedValueOnce({ ok: true });
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[0]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toContain("Connected.");
    });
  });

  it("uses Could not test fallback when weather test omits error", async () => {
    mockTestWeather.mockResolvedValueOnce({ ok: false });
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[0]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Could not test the weather connection/,
      );
    });
  });

  it("uses Connected. fallback when maps test omits message", async () => {
    mockTestMaps.mockResolvedValueOnce({ ok: true });
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[1]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toContain("Connected.");
    });
  });

  it("toasts operator-safe error when maps test throws", async () => {
    mockTestMaps.mockRejectedValueOnce(new ApiError(502, "maps_probe_secret"));
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[1]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Could not test the maps connection/,
      );
    });
    expect(screen.queryByText("maps_probe_secret")).toBeNull();
  });

  it("blocks commercial Open-Meteo subhosts without an API key", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLSelectElement>("external-weather-provider"), {
      target: { value: "openmeteo" },
    });
    fireEvent.change(el<HTMLInputElement>("external-weather-base-url"), {
      target: { value: "https://foo.customer-api.open-meteo.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/API key/i);
    });
    expect(mockSaveWeather).not.toHaveBeenCalled();
  });

  it("blocks save when max zoom is not a finite number", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-maps-max-zoom"), {
      target: { value: "abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/Max zoom must be a number/);
    });
    expect(mockSaveMaps).not.toHaveBeenCalled();
  });

  it("blocks save when max zoom is below 1", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-maps-max-zoom"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/Max zoom must be a number/);
    });
    expect(mockSaveMaps).not.toHaveBeenCalled();
  });

  it("clears validation errors when Reset is clicked after a failed save", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-maps-max-zoom"), {
      target: { value: "99" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/Max zoom/);
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("navigates to Support contact from the MET Norway notice", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({ weather: { contact_configured: false } }),
    );
    const { MemoryRouter, Route, Routes, useLocation } = await import("react-router");
    const { render } = await import("@testing-library/react");
    const { ToastProvider } = await import("@admitto/ui");

    function LocationProbe() {
      const location = useLocation();
      return <p data-testid="loc">{`${location.pathname}${location.search}`}</p>;
    }

    render(
      <MemoryRouter initialEntries={["/admin/settings?tab=external"]}>
        <ToastProvider>
          <Routes>
            <Route
              path="/admin/settings"
              element={
                <>
                  <ExternalServicesPanel />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open Support contact" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Open Support contact" }));
    await waitFor(() => {
      expect(screen.getByTestId("loc").textContent).toBe("/admin/settings?tab=general");
    });
  });

  it("maps maps probe machine codes to safe toast copy", async () => {
    mockTestMaps.mockResolvedValueOnce({ ok: false, error: "url_host_blocked" });
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[1]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/private or local network/i);
    });
  });

  it("maps unknown machine probe codes to the generic maps fallback", async () => {
    mockTestMaps.mockResolvedValueOnce({ ok: false, error: "some_unknown_code" });
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[1]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Could not test the maps connection/,
      );
    });
    expect(screen.queryByText("some_unknown_code")).toBeNull();
  });

  it("maps unknown weather machine probe codes to the generic weather fallback", async () => {
    mockTestWeather.mockResolvedValueOnce({ ok: false, error: "wx_mystery_code" });
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[0]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Could not test the weather connection/,
      );
    });
    expect(screen.queryByText("wx_mystery_code")).toBeNull();
  });

  it("maps weather url_host_unresolved to operator-safe toast copy", async () => {
    mockTestWeather.mockResolvedValueOnce({ ok: false, error: "url_host_unresolved" });
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[0]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Could not resolve the weather/i);
    });
  });

  it("passes through human weather probe errors that are not machine codes", async () => {
    mockTestWeather.mockResolvedValueOnce({
      ok: false,
      error: "Upstream timed out after 5 seconds.",
    });
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[0]!);
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toContain(
        "Upstream timed out after 5 seconds.",
      );
    });
  });

  it("normalises unknown weather and maps provider values from the API", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({
        weather: { provider: "legacy-provider" as never },
        maps: { geocoding_provider: "google" as never },
      }),
    );
    await renderLoaded();
    expect(el<HTMLSelectElement>("external-weather-provider").value).toBe("metno");
    expect(el<HTMLSelectElement>("external-maps-provider").value).toBe("nominatim");
  });

  it("tests Open-Meteo with clearApiKey and no typed key", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({
        weather: {
          provider: "openmeteo",
          api_key: { configured: true, source: "organization" },
        },
      }),
    );
    await renderLoaded();
    fireEvent.change(el<HTMLSelectElement>("external-weather-provider"), {
      target: { value: "openmeteo" },
    });
    const clear = el<HTMLInputElement>("external-weather-clear-api-key");
    fireEvent.click(clear);
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[0]!);
    await waitFor(() => {
      expect(mockTestWeather).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "openmeteo",
          clearApiKey: true,
        }),
      );
    });
    expect(mockTestWeather.mock.calls.at(-1)?.[0]).not.toHaveProperty("apiKey");
  });

  it("keeps weather draft when maps save fails and vice versa", async () => {
    mockSaveMaps.mockRejectedValueOnce(new ApiError(500, "maps_only_secret"));
    await renderLoaded();
    fireEvent.click(el<HTMLInputElement>("external-weather-enabled"));
    fireEvent.change(el<HTMLInputElement>("external-maps-geocoding-base-url"), {
      target: { value: "https://nominatim.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Could not save maps settings/);
    });
    expect(mockSaveWeather).toHaveBeenCalled();
    expect(el<HTMLInputElement>("external-weather-enabled").checked).toBe(false);
  });

  it("saves maps when disabling the Maps switch", async () => {
    await renderLoaded();
    fireEvent.click(el<HTMLInputElement>("external-maps-enabled"));
    expect(screen.getByText("Off")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSaveMaps).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });
    expect(mockSaveWeather).not.toHaveBeenCalled();
    expect(screen.getByTestId("at-toast").textContent).toContain("External services saved.");
  });

  it("saves maps attribution edits", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-maps-attribution"), {
      target: { value: "© Example Tiles" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSaveMaps).toHaveBeenCalledWith(
        expect.objectContaining({ attribution: "© Example Tiles" }),
      );
    });
  });

  it("keeps Nominatim when the maps provider select is changed", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLSelectElement>("external-maps-provider"), {
      target: { value: "nominatim" },
    });
    expect(el<HTMLSelectElement>("external-maps-provider").value).toBe("nominatim");
  });

  it("allows Open-Meteo save with an invalid base URL (commercial host gate stays off)", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLSelectElement>("external-weather-provider"), {
      target: { value: "openmeteo" },
    });
    fireEvent.change(el<HTMLInputElement>("external-weather-base-url"), {
      target: { value: "not-a-url" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSaveWeather).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "openmeteo", baseUrl: "not-a-url" }),
      );
    });
    expect(screen.queryByText(/API key is required/i)).toBeNull();
  });

  it("saves Open-Meteo base URL without sending apiKey when none is typed", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({
        weather: {
          provider: "openmeteo",
          base_url: "https://api.open-meteo.com",
          api_key: { configured: true, source: "organization" },
        },
      }),
    );
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-weather-base-url"), {
      target: { value: "https://api.open-meteo.com/v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSaveWeather).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "openmeteo",
          baseUrl: "https://api.open-meteo.com/v2",
        }),
      );
    });
    expect(mockSaveWeather.mock.calls.at(-1)?.[0]).not.toHaveProperty("apiKey");
  });

  it("tests Open-Meteo without apiKey or clearApiKey when none is typed", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLSelectElement>("external-weather-provider"), {
      target: { value: "openmeteo" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[0]!);
    await waitFor(() => {
      expect(mockTestWeather).toHaveBeenCalledWith({
        provider: "openmeteo",
        baseUrl: "https://api.open-meteo.com",
      });
    });
  });

  it("restores the API key field when Clear organisation API key is unchecked", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({
        weather: {
          provider: "openmeteo",
          api_key: { configured: true, source: "organization" },
        },
      }),
    );
    await renderLoaded();
    fireEvent.change(el<HTMLSelectElement>("external-weather-provider"), {
      target: { value: "openmeteo" },
    });
    const clear = el<HTMLInputElement>("external-weather-clear-api-key");
    fireEvent.click(clear);
    expect(clear.checked).toBe(true);
    fireEvent.click(clear);
    expect(clear.checked).toBe(false);
    expect(el<HTMLInputElement>("external-weather-api-key").disabled).toBe(false);
  });

  it("maps remaining weather and maps probe codes to operator-safe toast copy", async () => {
    async function expectLatestToast(pattern: RegExp | string) {
      await waitFor(() => {
        const toasts = screen.getAllByTestId("at-toast");
        const latest = toasts.at(-1)?.textContent ?? "";
        if (typeof pattern === "string") expect(latest).toContain(pattern);
        else expect(latest).toMatch(pattern);
      });
    }

    mockTestWeather.mockResolvedValueOnce({ ok: false, error: "url_host_blocked" });
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[0]!);
    await expectLatestToast(/private or local network/i);

    mockTestMaps.mockResolvedValueOnce({ ok: false, error: "invalid_geocoding_base_url" });
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[1]!);
    await expectLatestToast(/valid public http/i);

    mockTestMaps.mockResolvedValueOnce({ ok: false, error: "url_host_unresolved" });
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[1]!);
    await expectLatestToast(/Could not resolve the geocoding/i);

    mockTestMaps.mockResolvedValueOnce({ ok: false });
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[1]!);
    await expectLatestToast(/Could not test the maps connection/);

    mockTestMaps.mockResolvedValueOnce({ ok: false, error: "Nominatim timed out." });
    fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[1]!);
    await expectLatestToast("Nominatim timed out.");
  });

  it("ignores a late successful load after abort", async () => {
    let resolveFetch!: (value: ExternalServicesResponse) => void;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const { unmount } = renderWithToastAndRouter(<ExternalServicesPanel />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    unmount();
    resolveFetch(sampleResponse());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(document.getElementById("external-weather-provider")).toBeNull();
  });

  it("ignores a late load error after abort", async () => {
    let rejectFetch!: (reason?: unknown) => void;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFetch = reject;
        }),
    );
    const { unmount } = renderWithToastAndRouter(<ExternalServicesPanel />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    unmount();
    rejectFetch(new ApiError(500, "late_error"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Could not load external services")).toBeNull();
  });
});
