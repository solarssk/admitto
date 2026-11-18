import { useCallback, useRef } from "react";

/**
 * An `onData` for a tab's list that tells the page the list has changed: it says nothing for the first answer (the page has read what it
 * needs for itself) and calls `onChanged` for every later one (a save, a publish, a delete that was followed by a read).
 */
export function useAfterFirstAnswer(onChanged?: () => void): () => void {
  const answers = useRef(0);
  return useCallback(() => {
    answers.current += 1;
    if (answers.current > 1) onChanged?.();
  }, [onChanged]);
}
