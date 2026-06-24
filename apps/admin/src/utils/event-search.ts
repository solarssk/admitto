function normalizeForSearch(str: string): string {
  return str.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Client-side filter for the events picker search box. */
export function filterEventsBySearch<T extends { title: string; location?: string | null }>(
  events: T[],
  query: string,
): T[] {
  const q = normalizeForSearch(query.trim());
  if (!q) return events;
  return events.filter(
    (event) =>
      normalizeForSearch(event.title).includes(q) ||
      (event.location != null && normalizeForSearch(event.location).includes(q)),
  );
}
