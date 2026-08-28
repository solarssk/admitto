import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useBlocker, useLocation, type BlockerFunction, type NavigateFunction } from "react-router";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { IDENTITY_PROVIDERS_ROUTE } from "./routes.js";

/** Router-level dirty guard + discard-confirmation flow shared by CfAccessEditor and
 * IdentityProviderEditor - both editors need to stop a superadmin from silently losing unsaved
 * edits to an in-app navigation (Identity tabs / Settings sidebar / SPA back button), which
 * `beforeunload` alone doesn't catch, and both close back to `IDENTITY_PROVIDERS_ROUTE`.
 *
 * `skipBlockRef` is a one-shot bypass for the programmatic exits this hook and its caller
 * trigger (Cancel after confirm, Save) - the location effect re-arms it after each completed
 * navigation so the next dirty edit is still guarded. Returned so a caller's own success path
 * (e.g. after a save) can also set it before navigating away.
 *
 * `isBusy` gates Cancel/Escape only - every dismissal path funnels through the returned
 * `handleCancel`, so blocking it while a save/test/discover request is in flight is simpler and
 * safer than trying to cancel or ignore that in-flight request. */
export function useUnsavedChangesGuard(
  panelRef: RefObject<HTMLElement | null>,
  dirty: boolean,
  isBusy: boolean,
  navigate: NavigateFunction,
  focusWhenReady: unknown,
) {
  const skipBlockRef = useRef(false);
  const location = useLocation();
  useEffect(() => {
    skipBlockRef.current = false;
  }, [location.pathname]);
  const blocker = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) => {
        if (skipBlockRef.current) return false;
        if (!dirty) return false;
        return nextLocation.pathname !== currentLocation.pathname;
      },
      [dirty],
    ),
  );
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const handleCancel = useCallback(() => {
    if (isBusy) return;
    if (dirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    skipBlockRef.current = true;
    navigate(IDENTITY_PROVIDERS_ROUTE);
  }, [isBusy, dirty, navigate]);

  // Suspended while either discard dialog is open - otherwise the editor's own Escape/keydown
  // listener (registered first, since it mounts before either dialog opens) fires first and
  // reopens a second, visually identical discard dialog instead of leaving the topmost one to
  // handle Escape alone (bot review finding; same pattern as UserEditModal's
  // `anyConfirmDialogOpen`).
  useModalFocusTrap(
    panelRef,
    !discardConfirmOpen && blocker.state !== "blocked",
    handleCancel,
    focusWhenReady,
  );

  return { skipBlockRef, blocker, discardConfirmOpen, setDiscardConfirmOpen, handleCancel };
}
