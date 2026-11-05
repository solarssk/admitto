import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { SensitiveRevealDto } from "../api/types.js";

/** How long the answers stay on screen after "Show" (D-E6). */
export const REVEAL_VISIBLE_MS = 120_000;

/** What the screen of one person's sensitive answers is in. `asking` is the confirmation that the click is recorded. */
export type RevealState = { step: "hidden" } | { step: "asking" } | { step: "loading" } | { step: "shown"; answers: Readonly<Record<string, string>> };

const COULD_NOT_SHOW = "Could not show the answers.";

/** What a failed "Show" says: the helper's sentence for a refusal it knows, and for a failure of the server only the fixed one, whatever text came with it. */
function failureMessage(err: unknown): string {
  return err instanceof ApiError && err.status >= 500 ? COULD_NOT_SHOW : operatorApiErrorMessage(err, COULD_NOT_SHOW);
}

/** The answers of the guest in the answer to "Show". */
export function guestAnswers(dto: SensitiveRevealDto): Record<string, string> {
  return dto.guest;
}

/** The answers of the companion of this slot in the answer to "Show"; none when the answer has no entry for it. */
export function companionAnswers(dto: SensitiveRevealDto, slot: number): Record<string, string> {
  return dto.companions.find((companion) => companion.slot === slot)?.answers ?? {};
}

export interface SensitiveReveal {
  state: RevealState;
  /** Why the last "Show" failed, in the words of the helper; never a value. */
  error: string | null;
  /** Said to assistive tech when the answers went away again. */
  hiddenNotice: string;
  ask: () => void;
  cancel: () => void;
  confirm: () => void;
  hide: () => void;
}

/**
 * What one person's "Show" holds (D-E6). The answers live only in this state: not in a cache of the app, not in storage, not in the
 * address, not in the console and not in an error text. They go away on Hide, after two minutes, when the component goes (another
 * person, a closed window, a left page), and an answer that comes after any of those is dropped.
 */
export function useSensitiveReveal(load: () => Promise<Record<string, string>>): SensitiveReveal {
  const [state, setState] = useState<RevealState>({ step: "hidden" });
  const [error, setError] = useState<string | null>(null);
  const [hiddenNotice, setHiddenNotice] = useState("");
  // The request that is waited for: a Hide, a cancel or an unmount ends the wait by moving this on.
  const request = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const shown = state.step === "shown";
  useEffect(() => {
    if (!shown) return undefined;
    const timer = setTimeout(() => {
      setState({ step: "hidden" });
      setHiddenNotice("Sensitive answers hidden");
    }, REVEAL_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  const ask = useCallback(() => {
    setError(null);
    setHiddenNotice("");
    setState({ step: "asking" });
  }, []);
  const cancel = useCallback(() => setState({ step: "hidden" }), []);
  const hide = useCallback(() => {
    request.current += 1;
    setState({ step: "hidden" });
    setHiddenNotice("Sensitive answers hidden");
  }, []);
  const confirm = useCallback(() => {
    request.current += 1;
    const mine = request.current;
    setState({ step: "loading" });
    loadRef
      .current()
      .then((answers) => {
        if (request.current === mine) setState({ step: "shown", answers });
      })
      .catch((err: unknown) => {
        if (request.current !== mine) return;
        setError(failureMessage(err));
        setState({ step: "hidden" });
      });
  }, []);

  return { state, error, hiddenNotice, ask, cancel, confirm, hide };
}
