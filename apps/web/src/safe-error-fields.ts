/** What may be logged about a failure: its name and code, never its message, because a driver or provider
 * error message can carry query values (a session token hash, say) or endpoint and configuration details. */
export function safeErrorFields(err: unknown): { error_name: string; error_code?: string } {
  if (!(err instanceof Error)) return { error_name: "unknown" };
  const code = (err as { code?: unknown }).code;
  return { error_name: err.name, ...(typeof code === "string" ? { error_code: code } : {}) };
}
