import { useCallback, useState } from "react";

/** Tracks ids of in-flight per-row requests — double-submit guard for list toggles. */
export function useInFlightIds() {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());

  const start = useCallback((id: string) => {
    setIds((prev) => new Set(prev).add(id));
  }, []);

  const finish = useCallback((id: string) => {
    setIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  return { ids, start, finish };
}
