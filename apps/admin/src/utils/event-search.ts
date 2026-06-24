/** Client-side filter for the events picker search box. */
export function filterEventsBySearch<T extends { title: string; location?: string | null }>(
  events: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return events;
  return events.filter(
    (event) =>
      event.title.toLowerCase().includes(q) ||
      (event.location?.toLowerCase().includes(q) ?? false),
  );
}
