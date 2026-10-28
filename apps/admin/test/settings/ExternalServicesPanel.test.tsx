// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalServicesPanel } from "../../src/settings/ExternalServicesPanel.js";
import { advanceTimers, hangUntilAborted, renderWithToastAndRouter, isOff } from "../test-utils.js";
import { describePanelLoading } from "./panel-loading.js";
import type { ExternalServicesResponse, RegistrationTurnstileDto } from "../../src/api/types.js";
import { accessMethodsDto } from "./accessMethodsFixtures.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchExternalServices: vi.fn(),
    fetchRegistrationAccessMethods: vi.fn(),
    fetchRegistrationTurnstile: vi.fn(),
    saveRegistrationAccessMethods: vi.fn(),
    saveRegistrationTurnstile: vi.fn(),
    saveWeatherSettings: vi.fn(),
    saveMapsSettings: vi.fn(),
    testWeatherConnection: vi.fn(),
    testMapsConnection: vi.fn(),
  };
});

import {
  ApiError,
  fetchExternalServices,
  fetchRegistrationAccessMethods,
  fetchRegistrationTurnstile,
  saveMapsSettings,
  saveRegistrationAccessMethods,
  saveRegistrationTurnstile,
  saveWeatherSettings,
  testMapsConnection,
  testWeatherConnection,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchExternalServices);
const mockFetchTurnstile = vi.mocked(fetchRegistrationTurnstile);
const mockSaveTurnstile = vi.mocked(saveRegistrationTurnstile);
const mockFetchAccess = vi.mocked(fetchRegistrationAccessMethods);
const mockSaveAccess = vi.mocked(saveRegistrationAccessMethods);
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

function sampleTurnstile(overrides: Partial<RegistrationTurnstileDto> = {}): RegistrationTurnstileDto {
  return { site_key: null, secret_set: false, status: "incomplete", ...overrides };
}

const READY_TURNSTILE = sampleTurnstile({ site_key: "0x4AAAAAAAsite", secret_set: true, status: "ready" });

beforeEach(() => {
  mockFetch.mockResolvedValue(sampleResponse());
  mockFetchTurnstile.mockResolvedValue(sampleTurnstile());
  mockFetchAccess.mockResolvedValue(accessMethodsDto());
  mockSaveAccess.mockImplementation((body) => Promise.resolve(accessMethodsDto(body.methods)));
  mockSaveTurnstile.mockImplementation(async (body) => ({
    site_key: body.site_key === undefined ? null : body.site_key,
    secret_set: body.secret_key !== null && body.secret_key !== undefined,
    status: "ready",
  }));
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

describePanelLoading({
  label: "Loading external services",
  errorTitle: "Could not load external services",
  render: () => renderWithToastAndRouter(<ExternalServicesPanel />),
  hang: () => mockFetch.mockImplementationOnce(hangUntilAborted),
});

describe("ExternalServicesPanel", () => {
  it("keeps the error and a busy Retry on screen while it loads again, with no toast", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToastAndRouter(<ExternalServicesPanel />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.queryByTestId("at-toast")).toBeNull();
    let resolveRetry: (value: ExternalServicesResponse) => void = () => {};
    mockFetch.mockReturnValueOnce(new Promise((resolve) => (resolveRetry = resolve)));
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByText("Could not load external services")).toBeTruthy();
    await act(async () => resolveRetry(sampleResponse()));
    await waitFor(() => expect(document.getElementById("external-weather-provider")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("keeps a Test connection focusable and busy as Testing… while it works, without touching the other one", async () => {
    await renderLoaded();
    let resolveWeather: (value: { ok: true }) => void = () => {};
    mockTestWeather.mockReturnValueOnce(new Promise((resolve) => (resolveWeather = resolve)));
    const [weatherButton, mapsButton] = screen.getAllByRole("button", { name: "Test connection" });
    weatherButton!.focus();
    fireEvent.click(weatherButton!);
    const busy = await screen.findByRole("button", { name: "Testing…" });
    expect(busy).toBe(weatherButton);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(busy);
    expect(mapsButton!.getAttribute("aria-busy")).toBeNull();
    fireEvent.click(busy);
    expect(mockTestWeather).toHaveBeenCalledTimes(1);
    await act(async () => resolveWeather({ ok: true }));
    await waitFor(() => expect(weatherButton!.getAttribute("aria-busy")).toBeNull());
    expect(weatherButton!.textContent).toContain("Test connection");
  });

  it("keeps the maps Test connection busy on its own, without touching the weather one", async () => {
    await renderLoaded();
    let resolveMaps: (value: { ok: true }) => void = () => {};
    mockTestMaps.mockReturnValueOnce(new Promise((resolve) => (resolveMaps = resolve)));
    const [weatherButton, mapsButton] = screen.getAllByRole("button", { name: "Test connection" });
    fireEvent.click(mapsButton!);
    const busy = await screen.findByRole("button", { name: "Testing…" });
    expect(busy).toBe(mapsButton);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(false);
    expect(weatherButton!.getAttribute("aria-busy")).toBeNull();
    fireEvent.click(busy);
    expect(mockTestMaps).toHaveBeenCalledTimes(1);
    await act(async () => resolveMaps({ ok: true }));
    await waitFor(() => expect(mapsButton!.getAttribute("aria-busy")).toBeNull());
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
    fireEvent.click(el<HTMLButtonElement>("external-weather-provider"));
    fireEvent.click(screen.getByRole("button", { name: "Open-Meteo" }));
    expect(document.getElementById("external-weather-base-url")).toBeTruthy();
    expect(document.getElementById("external-weather-api-key")).toBeTruthy();
    expect(screen.getByText(/non-commercial/i)).toBeTruthy();
  });

  it("blocks save when commercial Open-Meteo host has no API key", async () => {
    await renderLoaded();
    fireEvent.click(el<HTMLButtonElement>("external-weather-provider"));
    fireEvent.click(screen.getByRole("button", { name: "Open-Meteo" }));
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

  it("disables Save when there are no dirty fields", async () => {
    await renderLoaded();
    expect(isOff(screen.getByRole("button", { name: "Save" }))).toBe(true);
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
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to save weather settings/);
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
    fireEvent.click(el<HTMLButtonElement>("external-weather-provider"));
    fireEvent.click(screen.getByRole("button", { name: "Open-Meteo" }));
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
    fireEvent.click(el<HTMLButtonElement>("external-weather-provider"));
    fireEvent.click(screen.getByRole("button", { name: "Open-Meteo" }));
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
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to save maps settings/);
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
    fireEvent.click(el<HTMLButtonElement>("external-weather-provider"));
    fireEvent.click(screen.getByRole("button", { name: "Open-Meteo" }));
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
      expect(toast).toMatch(/Failed to save weather settings/);
      expect(toast).toMatch(/Failed to save maps settings/);
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
    fireEvent.click(el<HTMLButtonElement>("external-weather-provider"));
    fireEvent.click(screen.getByRole("button", { name: "Open-Meteo" }));
    fireEvent.change(el<HTMLInputElement>("external-weather-base-url"), {
      target: { value: "https://foo.customer-api.open-meteo.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      // Two alerts, not a duplicate bug: the save-time summary list (all validation problems
      // at once) and the API key field's own inline error (Input's error prop, live-announced
      // as the user edits that field) both legitimately report the same problem here.
      expect(screen.getAllByRole("alert").some((el) => /API key/i.test(el.textContent ?? ""))).toBe(true);
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

  it("keeps Reset enabled to clear a stale validation error after manually retyping the saved value", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-maps-max-zoom"), {
      target: { value: "99" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/Max zoom/);
    });
    // Retype the original saved value by hand instead of clicking Reset - this zeroes the dirty
    // diff without going through the code path that clears the stale error.
    fireEvent.change(el<HTMLInputElement>("external-maps-max-zoom"), {
      target: { value: "19" },
    });
    expect(screen.getByRole("alert").textContent).toMatch(/Max zoom/);
    expect(screen.getByRole("button", { name: "Reset" })).toHaveProperty("disabled", false);
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
    expect(el<HTMLButtonElement>("external-weather-provider").textContent).toContain("MET Norway");
    expect(el<HTMLButtonElement>("external-maps-provider").textContent).toContain(
      "OpenStreetMap (Nominatim)",
    );
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
    fireEvent.click(el<HTMLButtonElement>("external-weather-provider"));
    fireEvent.click(screen.getByRole("button", { name: "Open-Meteo" }));
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
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to save maps settings/);
    });
    expect(mockSaveWeather).toHaveBeenCalled();
    expect(el<HTMLInputElement>("external-weather-enabled").checked).toBe(false);
  });

  it("saves maps when disabling the Maps switch", async () => {
    await renderLoaded();
    fireEvent.click(el<HTMLInputElement>("external-maps-enabled"));
    expect(within(screen.getByText("Maps").closest(".at-card") as HTMLElement).getByText("Off")).toBeTruthy();
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
    fireEvent.click(el<HTMLButtonElement>("external-maps-provider"));
    fireEvent.click(screen.getByRole("button", { name: "OpenStreetMap (Nominatim)" }));
    expect(el<HTMLButtonElement>("external-maps-provider").textContent).toContain(
      "OpenStreetMap (Nominatim)",
    );
  });

  it("allows Open-Meteo save with an invalid base URL (commercial host gate stays off)", async () => {
    await renderLoaded();
    fireEvent.click(el<HTMLButtonElement>("external-weather-provider"));
    fireEvent.click(screen.getByRole("button", { name: "Open-Meteo" }));
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
    fireEvent.click(el<HTMLButtonElement>("external-weather-provider"));
    fireEvent.click(screen.getByRole("button", { name: "Open-Meteo" }));
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
    fireEvent.click(el<HTMLButtonElement>("external-weather-provider"));
    fireEvent.click(screen.getByRole("button", { name: "Open-Meteo" }));
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

describe("ExternalServicesPanel, guest registration card", () => {
  const card = () => screen.getByText("Guest registration").closest(".at-card") as HTMLElement;

  /** Opens the secret field, types a value and confirms it, as the mail and wallet panels do. */
  function typeSecret(value: string) {
    fireEvent.click(within(card()).getByRole("button", { name: "Set" }));
    fireEvent.change(el<HTMLInputElement>("external-turnstile-secret-key"), { target: { value } });
  }

  it("shows the card with its two keys, closed until both are saved", async () => {
    await renderLoaded();
    expect(within(card()).getByText("Not set up")).toBeTruthy();
    expect(el<HTMLInputElement>("external-turnstile-site-key").value).toBe("");
    expect(within(card()).getByText("Not set")).toBeTruthy();
    expect(card().textContent).toMatch(/public link or password form stays closed/);
    expect(card().textContent).toMatch(/privacy notice/);
  });

  it("shows the saved site key and says the secret is set, without any value for it", async () => {
    mockFetchTurnstile.mockResolvedValue(READY_TURNSTILE);
    await renderLoaded();
    expect(within(card()).getByText("Ready")).toBeTruthy();
    expect(el<HTMLInputElement>("external-turnstile-site-key").value).toBe("0x4AAAAAAAsite");
    expect(within(card()).getByText(/set$/)).toBeTruthy();
    expect(document.getElementById("external-turnstile-secret-key")).toBeNull();
    expect(within(card()).getByRole("button", { name: "Change" })).toBeTruthy();
  });

  it("warns when the saved secret cannot be read", async () => {
    mockFetchTurnstile.mockResolvedValue(sampleTurnstile({ site_key: "0x4AAAAAAAsite", secret_set: true, status: "unreadable" }));
    await renderLoaded();
    expect(within(card()).getByText("Needs attention")).toBeTruthy();
    expect(within(card()).getByText(/cannot be read, probably because ENCRYPTION_KEY changed/)).toBeTruthy();
  });

  it("saves a new site key and secret with the one Save, then shows the card as ready", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-turnstile-site-key"), { target: { value: "  0x4AAAAAAAsite " } });
    typeSecret("0x4AAAAAAAsecret");
    expect(isOff(screen.getByRole("button", { name: "Save" }))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("at-toast").textContent).toContain("External services saved."));
    expect(mockSaveTurnstile).toHaveBeenCalledWith({ site_key: "0x4AAAAAAAsite", secret_key: "0x4AAAAAAAsecret" });
    expect(mockSaveWeather).not.toHaveBeenCalled();
    expect(mockSaveMaps).not.toHaveBeenCalled();
    await waitFor(() => expect(within(card()).getByText("Ready")).toBeTruthy());
    // The typed secret is gone from the screen once saved.
    expect(document.getElementById("external-turnstile-secret-key")).toBeNull();
    expect(document.body.textContent).not.toContain("0x4AAAAAAAsecret");
    expect(isOff(screen.getByRole("button", { name: "Save" }))).toBe(true);
  });

  it("sends only the site key when only it changed", async () => {
    mockFetchTurnstile.mockResolvedValue(READY_TURNSTILE);
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-turnstile-site-key"), { target: { value: "0x4AAAAAAAnew" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockSaveTurnstile).toHaveBeenCalledWith({ site_key: "0x4AAAAAAAnew" }));
  });

  it("clears the secret with null when Clear is chosen and saved", async () => {
    mockFetchTurnstile.mockResolvedValue(READY_TURNSTILE);
    await renderLoaded();
    fireEvent.click(within(card()).getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockSaveTurnstile).toHaveBeenCalledWith({ secret_key: null }));
  });

  it("clears the site key when its field is emptied", async () => {
    mockFetchTurnstile.mockResolvedValue(READY_TURNSTILE);
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-turnstile-site-key"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockSaveTurnstile).toHaveBeenCalledWith({ site_key: null }));
  });

  it("blocks Save for a malformed site key or secret, and says what is wrong", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-turnstile-site-key"), { target: { value: "has space" } });
    typeSecret("two words");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("The site key can only contain letters, digits, hyphens and underscores.")).toBeTruthy();
      expect(screen.getByText("Enter the secret key without spaces.")).toBeTruthy();
    });
    expect(mockSaveTurnstile).not.toHaveBeenCalled();
  });

  it("discards a typed key when Reset is chosen", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-turnstile-site-key"), { target: { value: "0x4AAAAAAAdraft" } });
    typeSecret("draftSecret");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(el<HTMLInputElement>("external-turnstile-site-key").value).toBe("");
    expect(document.getElementById("external-turnstile-secret-key")).toBeNull();
    expect(isOff(screen.getByRole("button", { name: "Save" }))).toBe(true);
  });

  it("toasts an operator-safe error when saving the keys fails, and keeps what was typed", async () => {
    mockSaveTurnstile.mockRejectedValueOnce(new ApiError(500, "secret_internal_detail"));
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("external-turnstile-site-key"), { target: { value: "0x4AAAAAAAsite" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to save guest registration settings/));
    expect(screen.queryByText("secret_internal_detail")).toBeNull();
    expect(el<HTMLInputElement>("external-turnstile-site-key").value).toBe("0x4AAAAAAAsite");
    expect(isOff(screen.getByRole("button", { name: "Save" }))).toBe(false);
  });

  it("saves the keys together with a weather change, and reports a failure of only one of them", async () => {
    mockSaveWeather.mockRejectedValueOnce(new ApiError(500, "wx_secret"));
    await renderLoaded();
    fireEvent.click(el<HTMLInputElement>("external-weather-enabled"));
    fireEvent.change(el<HTMLInputElement>("external-turnstile-site-key"), { target: { value: "0x4AAAAAAAsite" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const toast = screen.getByTestId("at-toast").textContent ?? "";
      expect(toast).toMatch(/Failed to save weather settings/);
      expect(toast).not.toMatch(/guest registration/);
    });
    expect(mockSaveTurnstile).toHaveBeenCalledWith({ site_key: "0x4AAAAAAAsite" });
  });

  it("shows the load error and a Retry when the keys cannot be read", async () => {
    mockFetchTurnstile.mockRejectedValueOnce(new ApiError(403, "forbidden"));
    renderWithToastAndRouter(<ExternalServicesPanel />);
    await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText("Could not load external services")).toBeTruthy();
    expect(document.getElementById("external-turnstile-site-key")).toBeNull();
  });
});

describe("ExternalServicesPanel, ways in card", () => {
  type WayName = "Link" | "Password";
  const card = () => screen.getByText("Ways in").closest(".at-card") as HTMLElement;
  const wayIn = (name: WayName) => within(card()).getByRole("switch", { name }) as HTMLInputElement;
  const save = () => screen.getByRole("button", { name: "Save" });
  const keysWarning = () => within(card()).queryByText(/stay closed until the Turnstile keys above are ready/);
  const describedBy = (input: HTMLElement) => document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

  it("shows a switch for the link and one for the password, both off until a superadmin turns one on", async () => {
    await renderLoaded();
    expect(wayIn("Link").checked).toBe(false);
    expect(wayIn("Password").checked).toBe(false);
    expect(within(card()).getAllByText("Off")).toHaveLength(2);
    expect(within(card()).queryByRole("switch", { name: /sso|sign-in/i })).toBeNull();
    expect(isOff(save())).toBe(true);
    expect(mockFetchAccess).toHaveBeenCalledTimes(1);
  });

  it("says in the description of each switch what the way is, and in the card what turning one off does", async () => {
    await renderLoaded();
    expect(describedBy(wayIn("Link"))).toMatch(/Anyone who has the link of an event can open its form, after a bot check\./);
    expect(describedBy(wayIn("Password"))).toMatch(/needs the password of the event, as well as its link/);
    expect(card().textContent).toMatch(/An organiser can choose only a way that is on\./);
    expect(card().textContent).toMatch(/Turning one off closes the registration form of every event that uses it, at once: guests see a page that is not found\./);
    expect(card().textContent).toMatch(/Nothing is deleted, and turning it on again opens those forms again\./);
  });

  it("shows the ways that are on, as the server has them", async () => {
    mockFetchAccess.mockResolvedValue(accessMethodsDto(["password"]));
    await renderLoaded();
    expect(wayIn("Link").checked).toBe(false);
    expect(wayIn("Password").checked).toBe(true);
    expect(within(card()).getByText("On")).toBeTruthy();
    expect(within(card()).getByText("Off")).toBeTruthy();
    expect(isOff(save())).toBe(true);
  });

  it("saves a way that was turned on with the one Save, as the whole list, and shows it as saved", async () => {
    await renderLoaded();
    fireEvent.click(wayIn("Link"));
    expect(isOff(save())).toBe(false);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByTestId("at-toast").textContent).toContain("External services saved."));
    expect(mockSaveAccess).toHaveBeenCalledTimes(1);
    expect(mockSaveAccess).toHaveBeenCalledWith({ methods: ["link"] });
    expect(mockSaveWeather).not.toHaveBeenCalled();
    expect(mockSaveMaps).not.toHaveBeenCalled();
    expect(mockSaveTurnstile).not.toHaveBeenCalled();
    await waitFor(() => expect(isOff(save())).toBe(true));
    expect(wayIn("Link").checked).toBe(true);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("sends both ways, and the other one alone when one of two is turned off", async () => {
    mockFetchAccess.mockResolvedValue(accessMethodsDto(["link"]));
    await renderLoaded();
    fireEvent.click(wayIn("Password"));
    fireEvent.click(save());
    await waitFor(() => expect(mockSaveAccess).toHaveBeenLastCalledWith({ methods: ["link", "password"] }));
    await waitFor(() => expect(isOff(save())).toBe(true));
    fireEvent.click(wayIn("Link"));
    fireEvent.click(save());
    await waitFor(() => expect(mockSaveAccess).toHaveBeenLastCalledWith({ methods: ["password"] }));
  });

  it("sends an empty list when the last way that was on is turned off", async () => {
    mockFetchAccess.mockResolvedValue(accessMethodsDto(["link"]));
    await renderLoaded();
    fireEvent.click(wayIn("Link"));
    fireEvent.click(save());
    await waitFor(() => expect(mockSaveAccess).toHaveBeenCalledWith({ methods: [] }));
    await waitFor(() => expect(wayIn("Link").checked).toBe(false));
  });

  it("has nothing to save when a switch is turned back to what is saved", async () => {
    mockFetchAccess.mockResolvedValue(accessMethodsDto(["link"]));
    await renderLoaded();
    fireEvent.click(wayIn("Link"));
    fireEvent.click(wayIn("Link"));
    expect(isOff(save())).toBe(true);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    fireEvent.click(save());
    expect(mockSaveAccess).not.toHaveBeenCalled();
  });

  it("keeps a way that the card has no switch for, and that is on, when it saves the others", async () => {
    mockFetchAccess.mockResolvedValue(accessMethodsDto(["sso"]));
    await renderLoaded();
    fireEvent.click(wayIn("Link"));
    fireEvent.click(save());
    await waitFor(() => expect(mockSaveAccess).toHaveBeenCalledWith({ methods: ["link", "sso"] }));
    await waitFor(() => expect(isOff(save())).toBe(true));
    fireEvent.click(wayIn("Link"));
    fireEvent.click(save());
    await waitFor(() => expect(mockSaveAccess).toHaveBeenLastCalledWith({ methods: ["sso"] }));
  });

  it("discards a switch that was turned when Reset is chosen", async () => {
    mockFetchAccess.mockResolvedValue(accessMethodsDto(["password"]));
    await renderLoaded();
    fireEvent.click(wayIn("Link"));
    fireEvent.click(wayIn("Password"));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(wayIn("Link").checked).toBe(false);
    expect(wayIn("Password").checked).toBe(true);
    expect(isOff(save())).toBe(true);
  });

  it("warns that forms stay closed while a way is on and the Turnstile keys are not ready, even before it is saved", async () => {
    await renderLoaded();
    expect(keysWarning()).toBeNull();
    fireEvent.click(wayIn("Password"));
    expect(keysWarning()).toBeTruthy();
    fireEvent.click(wayIn("Password"));
    expect(keysWarning()).toBeNull();
  });

  it("does not warn when the Turnstile keys are ready, whatever way is on", async () => {
    mockFetchTurnstile.mockResolvedValue(READY_TURNSTILE);
    await renderLoaded();
    fireEvent.click(wayIn("Link"));
    fireEvent.click(wayIn("Password"));
    expect(keysWarning()).toBeNull();
  });

  it("warns for keys that cannot be read, which are not ready either", async () => {
    mockFetchTurnstile.mockResolvedValue(sampleTurnstile({ site_key: "0x4AAAAAAAsite", secret_set: true, status: "unreadable" }));
    mockFetchAccess.mockResolvedValue(accessMethodsDto(["link"], false));
    await renderLoaded();
    expect(keysWarning()).toBeTruthy();
  });

  it("drops the warning once the keys are saved in the same Save as the way", async () => {
    await renderLoaded();
    fireEvent.click(wayIn("Link"));
    fireEvent.change(el<HTMLInputElement>("external-turnstile-site-key"), { target: { value: "0x4AAAAAAAsite" } });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    fireEvent.change(el<HTMLInputElement>("external-turnstile-secret-key"), { target: { value: "0x4AAAAAAAsecret" } });
    expect(keysWarning()).toBeTruthy();
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByTestId("at-toast").textContent).toContain("External services saved."));
    expect(mockSaveTurnstile).toHaveBeenCalledTimes(1);
    expect(mockSaveAccess).toHaveBeenCalledWith({ methods: ["link"] });
    await waitFor(() => expect(keysWarning()).toBeNull());
    expect(wayIn("Link").checked).toBe(true);
  });

  it("toasts an operator-safe error when saving the ways fails, and keeps the switch and a Save to try again", async () => {
    mockSaveAccess.mockRejectedValueOnce(new ApiError(500, "secret_internal_detail"));
    await renderLoaded();
    fireEvent.click(wayIn("Link"));
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByTestId("at-toast").textContent).toContain("Failed to save the registration ways in."));
    expect(screen.queryByText("secret_internal_detail")).toBeNull();
    expect(screen.queryByText("External services saved.")).toBeNull();
    expect(wayIn("Link").checked).toBe(true);
    expect(isOff(save())).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByTestId("at-toast").textContent).toContain("External services saved."));
    expect(mockSaveAccess).toHaveBeenCalledTimes(2);
  });

  it("says in the words of the error code when the server refuses the save", async () => {
    mockSaveAccess.mockRejectedValueOnce(new ApiError(403, "forbidden"));
    await renderLoaded();
    fireEvent.click(wayIn("Link"));
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByTestId("at-toast").textContent).toContain("You do not have access."));
  });

  it("reports only the part that failed when the ways are saved with another card", async () => {
    mockSaveWeather.mockRejectedValueOnce(new ApiError(500, "wx_secret"));
    await renderLoaded();
    fireEvent.click(el<HTMLInputElement>("external-weather-enabled"));
    fireEvent.click(wayIn("Password"));
    fireEvent.click(save());
    await waitFor(() => {
      const toast = screen.getByTestId("at-toast").textContent ?? "";
      expect(toast).toMatch(/Failed to save weather settings/);
      expect(toast).not.toMatch(/ways in/);
    });
    expect(mockSaveAccess).toHaveBeenCalledWith({ methods: ["password"] });
    await waitFor(() => expect(wayIn("Password").checked).toBe(true));
    // The ways are saved, so the Save that is left is for the weather.
    fireEvent.click(save());
    await waitFor(() => expect(mockSaveWeather).toHaveBeenCalledTimes(2));
    expect(mockSaveAccess).toHaveBeenCalledTimes(1);
  });

  it("shows the load error and a Retry when the ways cannot be read, and the card after the Retry", async () => {
    mockFetchAccess.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToastAndRouter(<ExternalServicesPanel />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText("Could not load external services")).toBeTruthy();
    expect(screen.queryByText("secret_internal")).toBeNull();
    expect(screen.queryByText("Ways in")).toBeNull();
    expect(screen.queryByTestId("at-toast")).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(wayIn("Link")).toBeTruthy());
    expect(mockFetchAccess).toHaveBeenCalledTimes(2);
  });

  it("shows no card to someone the server refuses, only that they have no access", async () => {
    mockFetchAccess.mockRejectedValueOnce(new ApiError(403, "forbidden"));
    renderWithToastAndRouter(<ExternalServicesPanel />);
    await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText("You do not have access.")).toBeTruthy();
    expect(screen.queryByText("Ways in")).toBeNull();
    expect(document.getElementById("external-access-link")).toBeNull();
    expect(document.getElementById("external-access-password")).toBeNull();
  });

  describe("while only the ways in are slow", () => {
    describePanelLoading({
      label: "Loading external services",
      errorTitle: "Could not load external services",
      render: () => renderWithToastAndRouter(<ExternalServicesPanel />),
      hang: () => mockFetchAccess.mockImplementationOnce(hangUntilAborted),
    });

    it("draws the card in the placeholder, and no form until the answer is in", async () => {
      mockFetchAccess.mockImplementationOnce(hangUntilAborted);
      vi.useFakeTimers();
      renderWithToastAndRouter(<ExternalServicesPanel />);
      await advanceTimers(250);
      const region = screen.getByLabelText("Loading external services");
      expect(within(region).getByText("Ways in")).toBeTruthy();
      expect(document.getElementById("external-weather-provider")).toBeNull();
      expect(document.getElementById("external-access-link")).toBeNull();
    });
  });
});
