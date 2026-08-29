export function useEventStream() {
  return { connected: true, status: "connected" as const };
}
