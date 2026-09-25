/** The one day an Open-Meteo answer repeats for every date: high and low in °C, and WMO code. */
export interface ForecastDay {
  max: number;
  min: number;
  code: number;
}

/** An Open-Meteo answer covering the 16 days from `from`, by default 20/11 °C with code 61. */
export function openMeteoForecastResponse(
  from: Date,
  day: ForecastDay = { max: 19.6, min: 11.2, code: 61 },
): Response {
  const time = Array.from({ length: 16 }, (_, i) => {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  return new Response(
    JSON.stringify({
      daily: {
        time,
        weather_code: time.map(() => day.code),
        temperature_2m_max: time.map(() => day.max),
        temperature_2m_min: time.map(() => day.min),
      },
    }),
    { status: 200 },
  );
}
