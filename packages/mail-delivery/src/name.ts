/** Split display name into first / last on first whitespace. */
export function splitDisplayName(fullName: string): { first_name: string; last_name: string } {
  const trimmed = fullName.trim();
  const space = trimmed.indexOf(" ");
  if (space === -1) {
    return { first_name: trimmed, last_name: "" };
  }
  return {
    first_name: trimmed.slice(0, space),
    last_name: trimmed.slice(space + 1).trim(),
  };
}
