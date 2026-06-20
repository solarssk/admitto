type ClientErrorContext = {
  source: string;
  componentStack?: string;
};

/** Report a client-side error: verbose in dev, structured server log in production. */
export function reportClientError(error: unknown, context: ClientErrorContext): void {
  const err = error instanceof Error ? error : new Error(String(error));

  if (import.meta.env.DEV) {
    console.error(`[${context.source}]`, err, context.componentStack);
    return;
  }

  const payload = {
    source: context.source.slice(0, 64),
    name: err.name.slice(0, 100),
    message: err.message.slice(0, 500),
    path: window.location.pathname.slice(0, 256),
  };

  void fetch("/api/admin/client-errors", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Origin: window.location.origin,
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    /* fire-and-forget */
  });
}
