import { afterEach, describe, expect, it } from "vitest";
import {
  createWeatherCache,
  getSharedWeatherCache,
  resetSharedWeatherCacheForTests,
} from "../../src/weather/weather-cache.js";

describe("getSharedWeatherCache", () => {
  afterEach(async () => {
    await resetSharedWeatherCacheForTests();
  });

  it("reuses one process-wide instance across calls", () => {
    const a = getSharedWeatherCache({ NODE_ENV: "test" });
    const b = getSharedWeatherCache({ NODE_ENV: "test" });
    expect(a).toBe(b);
  });

  it("createWeatherCache still returns a fresh instance when asked", () => {
    const shared = getSharedWeatherCache({ NODE_ENV: "test" });
    const fresh = createWeatherCache({ NODE_ENV: "test" });
    expect(fresh).not.toBe(shared);
  });
});
