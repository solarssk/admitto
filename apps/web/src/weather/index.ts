export {
  FORECAST_HORIZON_DAYS,
  FORECAST_HORIZON_DAYS_METNO,
  FORECAST_HORIZON_DAYS_OPENMETEO,
  MET_NO_FORECAST_BASE_URL,
  METNO_ATTRIBUTION_TEXT,
  METNO_ATTRIBUTION_URL,
  OPENMETEO_ATTRIBUTION_TEXT,
  OPENMETEO_ATTRIBUTION_URL,
  WEATHER_ATTRIBUTION_TEXT,
  WEATHER_ATTRIBUTION_URL,
  attributionForProvider,
  defaultWeatherConfig,
  forecastHorizonDays,
  isOpenMeteoCommercialHost,
  isWeatherProviderId,
  mergeWeatherConfig,
  resolveWeatherEnvConfig,
  weatherApiKeyRequired,
  type WeatherConfig,
  type WeatherConfigOverrides,
  type WeatherProviderId,
} from "./config.js";
export { OpenMeteoClient, WeatherProviderError, pickDailyForecast } from "./open-meteo-client.js";
export { MetNoClient, metNoSymbolToWeatherCode, pickMetNoDailyForecast } from "./met-no-client.js";
export {
  WeatherService,
  eventDateYmd,
  getWeatherService,
  resetWeatherServiceForTests,
  summarizeMany,
  type EventWeatherInput,
} from "./weather-service.js";
export { weatherCodeInfo } from "./weather-codes.js";
export type { DayForecast, WeatherSummaryDto, WeatherSummaryStatus } from "./types.js";
export {
  InMemoryWeatherCache,
  createWeatherCache,
  weatherCacheKey,
} from "./weather-cache.js";
