/** Derive a URL-safe event slug from a title (lowercase, dashes, max length). */
export function slugFromTitle(title: string, maxLength = 60): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .slice(0, maxLength)
    .replace(/^-|-$/g, "");
}
