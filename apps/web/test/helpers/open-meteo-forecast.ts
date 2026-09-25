/** An Open-Meteo answer covering the 16 days from `from`, every day 20/11 °C with code 61. */
export function openMeteoForecastResponse(from: Date): Response {
  const time = Array.from({ length: 16 }, (_, i) => {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  return new Response(
    JSON.stringify({
      daily: {
        time,
        weather_code: time.map(() => 61),
        temperature_2m_max: time.map(() => 19.6),
        temperature_2m_min: time.map(() => 11.2),
      },
    }),
    { status: 200 },
  );
}
