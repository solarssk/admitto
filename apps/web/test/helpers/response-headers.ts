/** The headers of a response as a plain lower-case record, without the one that changes on every request. */
export function headersOf(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    if (name !== "date") out[name] = value;
  });
  return out;
}

/** One directive of a Content-Security-Policy, by name, as written (`script-src 'nonce-...'`). */
export function directive(csp: string, name: string): string | undefined {
  return csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
}
