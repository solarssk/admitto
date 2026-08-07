import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useNavigate } from "react-router";
import {
  Button,
  Card,
  EmptyState,
  HintLabel,
  Input,
  Notice,
  Switch,
  useToast,
} from "@admitto/ui";
import {
  fetchExternalServices,
  saveMapsSettings,
  saveWeatherSettings,
  saveWalletSettings,
  testWeatherConnection,
  testMapsConnection,
} from "../api/client.js";
import type { ExternalServicesResponse, WeatherProviderId } from "../api/types.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { NO_AUTOFILL_PROPS, SettingsFooter } from "./mailTransportFormParts.js";

const WEATHER_CARD_HINT =
  "Day-of forecast on the events list and public ticket when the event has a map pin.";
const WEATHER_CARD_INTRO =
  "Forecast for the event calendar day. Horizon depends on the provider (MET Norway about 9 days, Open-Meteo up to 16).";
const WEATHER_PROVIDER_HINT =
  "MET Norway needs no API key (User-Agent from Support contact). Open-Meteo supports free, customer, or self-hosted hosts.";
const WEATHER_BASE_URL_HINT =
  "Free (non-commercial): https://api.open-meteo.com. Commercial: https://customer-api.open-meteo.com (API key required). Self-hosted Open-Meteo: your own HTTPS base URL.";
const WEATHER_API_KEY_HINT =
  "Organisation API token for Open-Meteo. Required when Base URL is customer-api.open-meteo.com. Not your Admitto login password.";
const WEATHER_API_KEY_REQUIRED_MSG =
  "API key is required for customer-api.open-meteo.com.";
const WEATHER_METNO_CONTACT_MSG =
  "MET Norway requires an identifiable User-Agent. Set Support contact under Organisation settings > General, or forecasts will stay unavailable.";

/** Keep in sync with apps/web weather attributionForProvider (draft follows provider select). */
const WEATHER_ATTRIBUTION: Record<
  WeatherProviderId,
  { text: string; url: string }
> = {
  metno: {
    text: "Weather data by MET Norway",
    url: "https://www.met.no/en",
  },
  openmeteo: {
    text: "Weather data by Open-Meteo.com",
    url: "https://open-meteo.com/",
  },
};

const WALLET_CARD_HINT =
  "One PassCreator API key for the whole instance. The template each event's passes use is set on that event's Settings → Wallet tab.";
const WALLET_CARD_INTRO =
  "Lets attendees add their ticket to Apple Wallet or Google Wallet (PassCreator).";

const MAPS_CARD_INTRO =
  "Static map previews on event cards and tickets, plus address lookup on the Location tab.";
const MAPS_PROVIDER_DESC = "Only OpenStreetMap tiles with Nominatim geocoding are implemented.";
const MAPS_TILE_URL_DESC =
  "Leaflet tile template with {z}/{x}/{y}. Must be HTTPS (or http://localhost in development).";
const MAPS_ATTRIBUTION_DESC =
  "Shown on maps and list cards. HTML links are allowed for OpenStreetMap credit.";
const MAPS_MAX_ZOOM_DESC = "Highest zoom the tile server supports (typically 18-19).";
const MAPS_GEOCODING_URL_DESC = "Nominatim-compatible search and reverse endpoint.";

type MapsProviderId = "nominatim";

function normalizeMapsProvider(_raw: unknown): MapsProviderId {
  // Only Nominatim is implemented; coerce unknown/legacy values.
  return "nominatim";
}

/** Mirror of apps/web weather config — keep hosts in sync. */
function isOpenMeteoCommercialHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase();
    return (
      host === "customer-api.open-meteo.com" ||
      host.endsWith(".customer-api.open-meteo.com")
    );
  } catch {
    return false;
  }
}

type WeatherDraft = {
  enabled: boolean;
  provider: WeatherProviderId;
  baseUrl: string;
  apiKey: string;
  clearApiKey: boolean;
};

type MapsDraft = {
  enabled: boolean;
  tileUrl: string;
  attribution: string;
  maxZoom: string;
  geocodingProvider: string;
  geocodingBaseUrl: string;
};

function normalizeWeatherProvider(raw: unknown): WeatherProviderId {
  return raw === "openmeteo" ? "openmeteo" : "metno";
}

function weatherDraftFrom(data: ExternalServicesResponse["weather"]): WeatherDraft {
  return {
    enabled: data.enabled,
    provider: normalizeWeatherProvider(data.provider),
    baseUrl: data.base_url,
    apiKey: "",
    clearApiKey: false,
  };
}

function mapsDraftFrom(data: ExternalServicesResponse["maps"]): MapsDraft {
  return {
    enabled: data.enabled,
    tileUrl: data.tile_url,
    attribution: data.attribution,
    maxZoom: String(data.max_zoom),
    geocodingProvider: normalizeMapsProvider(data.geocoding_provider),
    geocodingBaseUrl: data.geocoding_base_url,
  };
}

function weatherDirty(draft: WeatherDraft, saved: WeatherDraft): boolean {
  return (
    draft.enabled !== saved.enabled ||
    draft.provider !== saved.provider ||
    draft.baseUrl !== saved.baseUrl ||
    draft.apiKey !== "" ||
    draft.clearApiKey !== saved.clearApiKey
  );
}

function mapsDirty(draft: MapsDraft, saved: MapsDraft): boolean {
  return (
    draft.enabled !== saved.enabled ||
    draft.tileUrl !== saved.tileUrl ||
    draft.attribution !== saved.attribution ||
    draft.maxZoom !== saved.maxZoom ||
    draft.geocodingProvider !== saved.geocodingProvider ||
    draft.geocodingBaseUrl !== saved.geocodingBaseUrl
  );
}

function apiKeyPlaceholder(required: boolean, configured: boolean): string {
  if (configured) return "••••••••";
  return required ? "Required" : "Optional";
}

/** Probe endpoints should return human copy; map leftover machine codes just in case. */
const WEATHER_PROBE_ERROR_COPY: Record<string, string> = {
  invalid_base_url: "Weather base URL must be a valid public http(s) URL.",
  url_host_blocked: "Weather base URL must not point at a private or local network address.",
  url_host_unresolved: "Could not resolve the weather base URL hostname.",
};

const MAPS_PROBE_ERROR_COPY: Record<string, string> = {
  invalid_geocoding_base_url: "Geocoding base URL must be a valid public http(s) URL.",
  url_host_blocked: "Geocoding base URL must not point at a private or local network address.",
  url_host_unresolved: "Could not resolve the geocoding base URL hostname.",
};

function probeResultToastMessage(
  result: { ok: boolean; message?: string; error?: string },
  opts: {
    successFallback: string;
    errorFallback: string;
    errorCopy: Record<string, string>;
  },
): string {
  if (result.ok) return result.message?.trim() || opts.successFallback;
  const raw = result.error?.trim() ?? "";
  if (!raw) return opts.errorFallback;
  if (opts.errorCopy[raw]) return opts.errorCopy[raw]!;
  // Machine-looking codes must never land in the toast.
  if (/^[a-z][a-z0-9_]*$/.test(raw)) return opts.errorFallback;
  return raw;
}

function collectSaveValidationErrors(opts: {
  apiKeyMissing: boolean;
  saveWeather: boolean;
  saveMaps: boolean;
  mapsDraft: MapsDraft;
}): string[] {
  const errors: string[] = [];
  if (opts.saveWeather && opts.apiKeyMissing) errors.push(WEATHER_API_KEY_REQUIRED_MSG);
  if (!opts.saveMaps) return errors;
  const maxZoom = Number.parseInt(opts.mapsDraft.maxZoom, 10);
  if (!Number.isFinite(maxZoom) || maxZoom < 1 || maxZoom > 22) {
    errors.push("Max zoom must be a number between 1 and 22.");
  }
  if (opts.mapsDraft.tileUrl.trim() && !opts.mapsDraft.tileUrl.includes("{z}")) {
    errors.push("Tile URL should include {z}/{x}/{y} placeholders.");
  }
  return errors;
}

function buildWeatherSaveBody(draft: WeatherDraft): {
  enabled: boolean;
  provider: WeatherProviderId;
  baseUrl?: string;
  apiKey?: string | null;
} {
  const body: {
    enabled: boolean;
    provider: WeatherProviderId;
    baseUrl?: string;
    apiKey?: string | null;
  } = {
    enabled: draft.enabled,
    provider: draft.provider,
  };
  if (draft.provider !== "openmeteo") return body;
  body.baseUrl = draft.baseUrl.trim();
  if (draft.clearApiKey) body.apiKey = "";
  else if (draft.apiKey.trim() !== "") body.apiKey = draft.apiKey.trim();
  return body;
}

type SettledSave = PromiseSettledResult<ExternalServicesResponse["weather"] | null>;
type SettledMapsSave = PromiseSettledResult<ExternalServicesResponse["maps"] | null>;

function toastExternalServicesSaveResult(
  addToast: (message: string, variant: "success" | "error" | "info") => void,
  opts: {
    saveWeather: boolean;
    saveMaps: boolean;
    weatherResult: SettledSave;
    mapsResult: SettledMapsSave;
  },
): void {
  const failures: string[] = [];
  if (opts.saveWeather && opts.weatherResult.status === "rejected") {
    failures.push(
      operatorApiErrorMessage(opts.weatherResult.reason, "Could not save weather settings."),
    );
  }
  if (opts.saveMaps && opts.mapsResult.status === "rejected") {
    failures.push(
      operatorApiErrorMessage(opts.mapsResult.reason, "Could not save maps settings."),
    );
  }
  if (failures.length === 0) {
    addToast("External services saved.", "success");
    return;
  }
  addToast(failures.join(" "), "error");
}

/** Form fields only mount after drafts load. */
function patchDraft<T>(
  setter: Dispatch<SetStateAction<T | null>>,
  patch: (current: T) => T,
): void {
  setter((current) => patch(current as T));
}

/**
 * Organisation Settings → External services (ADR 0040).
 * Weather and Maps are editable; distinct from Event Settings → Integrations.
 */
export function ExternalServicesPanel() {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<ExternalServicesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const showLoading = useDelayedLoading(loading);
  const [saving, setSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const validationErrorsRef = useRef<HTMLUListElement | null>(null);

  const [weatherDraft, setWeatherDraft] = useState<WeatherDraft | null>(null);
  const [mapsDraft, setMapsDraft] = useState<MapsDraft | null>(null);
  const weatherSavedRef = useRef<WeatherDraft | null>(null);
  const mapsSavedRef = useRef<MapsDraft | null>(null);
  const [weatherTesting, setWeatherTesting] = useState(false);
  const [mapsTesting, setMapsTesting] = useState(false);

  // Wallet is a single field with its own independent save (not part of the shared
  // weather+maps hasUnsavedChanges/handleSave flow above).
  const [walletApiKeyDraft, setWalletApiKeyDraft] = useState("");
  const [walletClearApiKey, setWalletClearApiKey] = useState(false);
  const [walletSaving, setWalletSaving] = useState(false);

  async function handleSaveWallet() {
    setWalletSaving(true);
    try {
      // Save is disabled unless walletClearApiKey is set or the draft has content, so the
      // trimmed draft is never empty here - no `|| undefined` fallback needed.
      const wallet = await saveWalletSettings({
        apiKey: walletClearApiKey ? null : walletApiKeyDraft.trim(),
      });
      setData((prev) => prev && { ...prev, wallet });
      setWalletApiKeyDraft("");
      setWalletClearApiKey(false);
      addToast("Wallet settings saved.", "success");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Could not save wallet settings."), "error");
    } finally {
      setWalletSaving(false);
    }
  }

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchExternalServices(signal);
      if (signal?.aborted) return;
      setData(res);
      const w = weatherDraftFrom(res.weather);
      const m = mapsDraftFrom(res.maps);
      setWeatherDraft(w);
      setMapsDraft(m);
      weatherSavedRef.current = w;
      mapsSavedRef.current = m;
      setValidationErrors([]);
    } catch (err) {
      if (signal?.aborted) return;
      setLoadError(operatorApiErrorMessage(err, "Could not load external services."));
      setData(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const hasUnsavedChanges = useMemo(() => {
    if (!weatherDraft || !mapsDraft || !weatherSavedRef.current || !mapsSavedRef.current) {
      return false;
    }
    return (
      weatherDirty(weatherDraft, weatherSavedRef.current) ||
      mapsDirty(mapsDraft, mapsSavedRef.current)
    );
  }, [weatherDraft, mapsDraft]);

  const showOpenMeteoFields = weatherDraft?.provider === "openmeteo";
  const apiKeyRequired = Boolean(
    weatherDraft?.enabled &&
      weatherDraft.provider === "openmeteo" &&
      isOpenMeteoCommercialHost(weatherDraft.baseUrl),
  );
  const apiKeyMissing = Boolean(
    apiKeyRequired &&
      weatherDraft &&
      !weatherDraft.apiKey.trim() &&
      (weatherDraft.clearApiKey || !data?.weather.api_key.configured),
  );
  const showMetNoContactNotice = Boolean(
    weatherDraft?.enabled &&
      weatherDraft.provider === "metno" &&
      data &&
      !data.weather.contact_configured,
  );

  if (showLoading && !data) {
    return (
      <Card title="External services">
        <p className="settings-card-intro">Loading…</p>
      </Card>
    );
  }

  if (loadError && !data) {
    return (
      <EmptyState
        title="Could not load external services"
        description={loadError}
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        }
      />
    );
  }

  if (!data || !weatherDraft || !mapsDraft) return null;

  // Narrowed locals: nested handlers do not keep the null-check narrowing on state.
  const weather = weatherDraft;
  const maps = mapsDraft;

  function handleReset() {
    setWeatherDraft({ ...weatherSavedRef.current! });
    setMapsDraft({ ...mapsSavedRef.current! });
    setValidationErrors([]);
  }

  async function handleTestWeather() {
    const body: {
      provider: WeatherProviderId;
      baseUrl?: string;
      apiKey?: string;
      clearApiKey?: boolean;
    } = { provider: weather.provider };
    if (weather.provider === "openmeteo") {
      body.baseUrl = weather.baseUrl.trim();
      if (weather.clearApiKey) body.clearApiKey = true;
      else if (weather.apiKey.trim() !== "") body.apiKey = weather.apiKey.trim();
    }
    setWeatherTesting(true);
    try {
      const result = await testWeatherConnection(body);
      addToast(
        probeResultToastMessage(result, {
          successFallback: "Connected.",
          errorFallback: "Could not test the weather connection.",
          errorCopy: WEATHER_PROBE_ERROR_COPY,
        }),
        result.ok ? "success" : "error",
      );
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Could not test the weather connection."), "error");
    } finally {
      setWeatherTesting(false);
    }
  }

  async function handleTestMaps() {
    setMapsTesting(true);
    try {
      const result = await testMapsConnection({
        geocodingBaseUrl: maps.geocodingBaseUrl.trim(),
      });
      addToast(
        probeResultToastMessage(result, {
          successFallback: "Connected.",
          errorFallback: "Could not test the maps connection.",
          errorCopy: MAPS_PROBE_ERROR_COPY,
        }),
        result.ok ? "success" : "error",
      );
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Could not test the maps connection."), "error");
    } finally {
      setMapsTesting(false);
    }
  }

  async function handleSave() {
    const savedWeather = weatherSavedRef.current!;
    const savedMaps = mapsSavedRef.current!;
    const saveWeather = weatherDirty(weather, savedWeather);
    const saveMaps = mapsDirty(maps, savedMaps);
    const errors = collectSaveValidationErrors({
      apiKeyMissing,
      saveWeather,
      saveMaps,
      mapsDraft: maps,
    });
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    if (!saveWeather && !saveMaps) {
      addToast("No changes to save.", "info");
      return;
    }

    setValidationErrors([]);
    setSaving(true);
    try {
      const maxZoom = Number.parseInt(maps.maxZoom, 10);
      const weatherBody = buildWeatherSaveBody(weather);
      const mapsBody = {
        enabled: maps.enabled,
        tileUrl: maps.tileUrl.trim(),
        attribution: maps.attribution.trim(),
        maxZoom,
        geocodingProvider: normalizeMapsProvider(maps.geocodingProvider),
        geocodingBaseUrl: maps.geocodingBaseUrl.trim(),
      };

      const [weatherResult, mapsResult] = await Promise.allSettled([
        saveWeather ? saveWeatherSettings(weatherBody) : Promise.resolve(null),
        saveMaps ? saveMapsSettings(mapsBody) : Promise.resolve(null),
      ]);

      if (weatherResult.status === "fulfilled" && weatherResult.value) {
        const w = weatherDraftFrom(weatherResult.value);
        setData((prev) => ({ ...prev!, weather: weatherResult.value! }));
        setWeatherDraft(w);
        weatherSavedRef.current = w;
      }
      if (mapsResult.status === "fulfilled" && mapsResult.value) {
        const m = mapsDraftFrom(mapsResult.value);
        setData((prev) => ({ ...prev!, maps: mapsResult.value! }));
        setMapsDraft(m);
        mapsSavedRef.current = m;
      }

      toastExternalServicesSaveResult(addToast, {
        saveWeather,
        saveMaps,
        weatherResult,
        mapsResult,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-sections">
      <Card
        title={<HintLabel hint={WEATHER_CARD_HINT}>Weather</HintLabel>}
        actions={
          <Switch
            id="external-weather-enabled"
            label={weatherDraft.enabled ? "On" : "Off"}
            checked={weatherDraft.enabled}
            onChange={(e) =>
              patchDraft(setWeatherDraft, (d) => ({ ...d, enabled: e.target.checked }))
            }
          />
        }
      >
        <div className="settings-card-stack">
          <p className="settings-card-intro">{WEATHER_CARD_INTRO}</p>
          <div className="mail-transport-section">
            <div className="mail-field-row">
              <div className="at-field">
                <span className="at-label">
                  <HintLabel hint={WEATHER_PROVIDER_HINT}>Provider</HintLabel>
                </span>
                <div className="external-provider-and-test">
                  <SearchableSelect
                    id="external-weather-provider"
                    label="Provider"
                    placeholder="Select provider…"
                    searchPlaceholder="Search providers…"
                    emptyLabel="No providers found"
                    showLabel={false}
                    value={weatherDraft.provider}
                    options={[
                      { id: "metno", label: "MET Norway" },
                      { id: "openmeteo", label: "Open-Meteo" },
                    ]}
                    disabled={weatherTesting}
                    onChange={(id) =>
                      patchDraft(setWeatherDraft, (d) => ({
                        ...d,
                        provider: normalizeWeatherProvider(id),
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={weatherTesting || saving}
                    onClick={() => void handleTestWeather()}
                    icon={<i className="ti ti-plug" aria-hidden="true" />}
                  >
                    {weatherTesting ? "Testing…" : "Test connection"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
          {showMetNoContactNotice && (
            <Notice
              variant="warning"
              role="alert"
              action={
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => navigate("/admin/settings?tab=general")}
                >
                  Open Support contact
                </button>
              }
            >
              {WEATHER_METNO_CONTACT_MSG}
            </Notice>
          )}
          {showOpenMeteoFields && (
            <>
              <Notice variant="warning">{data.weather.commercial_notice}</Notice>
              <div className="mail-transport-section">
                <div className="at-field">
                  <span className="at-label">
                    <HintLabel hint={WEATHER_BASE_URL_HINT}>Base URL</HintLabel>
                  </span>
                  <Input
                    id="external-weather-base-url"
                    name="weather-base-url"
                    value={weatherDraft.baseUrl}
                    disabled={weatherTesting}
                    placeholder="https://api.open-meteo.com"
                    {...NO_AUTOFILL_PROPS}
                    onChange={(e) =>
                      patchDraft(setWeatherDraft, (d) => ({ ...d, baseUrl: e.target.value }))
                    }
                  />
                </div>
                <div className="at-field mail-secret-field">
                  <span className="at-label">
                    <HintLabel hint={WEATHER_API_KEY_HINT}>API key</HintLabel>
                  </span>
                  <Input
                    type="text"
                    id="external-weather-api-key"
                    name="weather-org-api-token"
                    value={weatherDraft.apiKey}
                    disabled={weatherDraft.clearApiKey}
                    invalid={apiKeyMissing}
                    error={apiKeyMissing ? WEATHER_API_KEY_REQUIRED_MSG : undefined}
                    placeholder={apiKeyPlaceholder(
                      apiKeyRequired,
                      data.weather.api_key.configured,
                    )}
                    {...NO_AUTOFILL_PROPS}
                    onChange={(e) =>
                      patchDraft(setWeatherDraft, (d) => ({
                        ...d,
                        apiKey: e.target.value,
                        clearApiKey: false,
                      }))
                    }
                  />
                  {data.weather.api_key.configured && !apiKeyRequired && (
                    <label className="form-check" style={{ marginTop: "var(--space-2)" }}>
                      <input
                        type="checkbox"
                        id="external-weather-clear-api-key"
                        name="weather-clear-api-key"
                        checked={weatherDraft.clearApiKey}
                        onChange={(e) =>
                          patchDraft(setWeatherDraft, (d) => ({
                            ...d,
                            clearApiKey: e.target.checked,
                            apiKey: e.target.checked ? "" : d.apiKey,
                          }))
                        }
                      />
                      <span>Clear organisation API key</span>
                    </label>
                  )}
                </div>
              </div>
            </>
          )}
          <p className="settings-card-intro" style={{ margin: 0 }}>
            Attribution:{" "}
            <a
              href={WEATHER_ATTRIBUTION[weatherDraft.provider].url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {WEATHER_ATTRIBUTION[weatherDraft.provider].text}
            </a>
          </p>
        </div>
      </Card>

      <Card
        title="Maps"
        actions={
          <Switch
            id="external-maps-enabled"
            label={mapsDraft.enabled ? "On" : "Off"}
            checked={mapsDraft.enabled}
            onChange={(e) =>
              patchDraft(setMapsDraft, (d) => ({ ...d, enabled: e.target.checked }))
            }
          />
        }
      >
        <div className="settings-card-stack">
          <p className="settings-card-intro">{MAPS_CARD_INTRO}</p>
          <div className="mail-transport-section">
            <div className="mail-field-row">
              <div className="at-field">
                <span className="at-label">Provider</span>
                <div className="external-provider-and-test">
                  <SearchableSelect
                    id="external-maps-provider"
                    label="Provider"
                    placeholder="Select provider…"
                    searchPlaceholder="Search providers…"
                    emptyLabel="No providers found"
                    showLabel={false}
                    value={normalizeMapsProvider(mapsDraft.geocodingProvider)}
                    options={[{ id: "nominatim", label: "OpenStreetMap (Nominatim)" }]}
                    disabled={mapsTesting}
                    onChange={(id) =>
                      patchDraft(setMapsDraft, (d) => ({
                        ...d,
                        geocodingProvider: normalizeMapsProvider(id),
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={mapsTesting || saving}
                    onClick={() => void handleTestMaps()}
                    icon={<i className="ti ti-plug" aria-hidden="true" />}
                  >
                    {mapsTesting ? "Testing…" : "Test connection"}
                  </Button>
                </div>
                <p className="at-hint">{MAPS_PROVIDER_DESC}</p>
              </div>
            </div>
            <div className="mail-field-row">
              <div className="at-field">
                <span className="at-label">Tile URL</span>
                <Input
                  id="external-maps-tile-url"
                  name="maps-tile-url"
                  value={mapsDraft.tileUrl}
                  {...NO_AUTOFILL_PROPS}
                  onChange={(e) =>
                    patchDraft(setMapsDraft, (d) => ({ ...d, tileUrl: e.target.value }))
                  }
                />
                <p className="at-hint">{MAPS_TILE_URL_DESC}</p>
              </div>
            </div>
            <div className="mail-field-row">
              <div className="at-field">
                <span className="at-label">Attribution</span>
                <Input
                  id="external-maps-attribution"
                  name="maps-attribution"
                  value={mapsDraft.attribution}
                  {...NO_AUTOFILL_PROPS}
                  onChange={(e) =>
                    patchDraft(setMapsDraft, (d) => ({ ...d, attribution: e.target.value }))
                  }
                />
                <p className="at-hint">{MAPS_ATTRIBUTION_DESC}</p>
              </div>
            </div>
            <div className="maps-zoom-geocode-row">
              <div className="at-field">
                <span className="at-label">Max zoom</span>
                <Input
                  id="external-maps-max-zoom"
                  name="maps-max-zoom"
                  inputMode="numeric"
                  value={mapsDraft.maxZoom}
                  {...NO_AUTOFILL_PROPS}
                  onChange={(e) =>
                    patchDraft(setMapsDraft, (d) => ({ ...d, maxZoom: e.target.value }))
                  }
                />
                <p className="at-hint">{MAPS_MAX_ZOOM_DESC}</p>
              </div>
              <div className="at-field">
                <span className="at-label">Geocoding base URL</span>
                <Input
                  id="external-maps-geocoding-base-url"
                  name="maps-geocoding-base-url"
                  value={mapsDraft.geocodingBaseUrl}
                  disabled={mapsTesting}
                  {...NO_AUTOFILL_PROPS}
                  onChange={(e) =>
                    patchDraft(setMapsDraft, (d) => ({
                      ...d,
                      geocodingBaseUrl: e.target.value,
                    }))
                  }
                />
                <p className="at-hint">{MAPS_GEOCODING_URL_DESC}</p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title={<HintLabel hint={WALLET_CARD_HINT}>Wallet</HintLabel>}>
        <div className="settings-card-stack">
          <p className="settings-card-intro">{WALLET_CARD_INTRO}</p>
          <div className="at-field mail-secret-field">
            <span className="at-label">API key</span>
            <Input
              type="text"
              id="external-wallet-api-key"
              name="wallet-org-api-key"
              value={walletApiKeyDraft}
              disabled={walletSaving || walletClearApiKey}
              placeholder={apiKeyPlaceholder(false, data.wallet.api_key.configured)}
              {...NO_AUTOFILL_PROPS}
              onChange={(e) => {
                setWalletApiKeyDraft(e.target.value);
                setWalletClearApiKey(false);
              }}
            />
            {data.wallet.api_key.configured && data.wallet.api_key.source === "organization" && (
              <label className="form-check" style={{ marginTop: "var(--space-2)" }}>
                <input
                  type="checkbox"
                  checked={walletClearApiKey}
                  disabled={walletSaving}
                  onChange={(e) => {
                    setWalletClearApiKey(e.target.checked);
                    if (e.target.checked) setWalletApiKeyDraft("");
                  }}
                />
                <span>Clear organisation API key</span>
              </label>
            )}
          </div>
          {data.wallet.api_key.source === "env" && (
            <Notice variant="info">
              Currently using PASSCREATOR_API_KEY from the server environment. Saving a key here
              overrides it.
            </Notice>
          )}
          <div>
            <Button
              type="button"
              variant="primary"
              disabled={walletSaving || (!walletApiKeyDraft.trim() && !walletClearApiKey)}
              onClick={() => void handleSaveWallet()}
            >
              {walletSaving ? "Saving…" : "Save wallet settings"}
            </Button>
          </div>
        </div>
      </Card>

      <SettingsFooter
        validationErrors={validationErrors}
        validationErrorsRef={validationErrorsRef}
        hasUnsavedChanges={hasUnsavedChanges}
        saving={saving}
        onReset={handleReset}
        onSave={() => void handleSave()}
      />
    </div>
  );
}
