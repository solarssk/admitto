/** What an organization picker says when it has nothing to pick: that it could not load, or that there are none. */
export function organizationPlaceholder(error: string | null, count: number): string {
  if (error) return "Could not load organizations";
  return count === 0 ? "No organizations available" : "Select organization…";
}
