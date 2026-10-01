import type { SyntheticEvent } from "react";

const swallow = (event: SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

/**
 * What a card needs while its data is refreshed after a change and stays on screen (AGENTS.md "Admin SPA
 * loading and busy states"): at once, nothing in it can be used (see below) and it is marked busy; once the
 * wait is noticeable (`noticeable`, from `useLoadingGate`) it is also dimmed, so stale data does not look
 * current. The `account-refetch` class stops the pointer, dims, and makes the card the box the thin bar
 * (`TopProgressBar placement="container"`) runs along.
 *
 * Keys are stopped too, one of two ways. By default the card is `inert`: nothing in it can be focused or
 * activated. `inert` also takes keyboard focus off whatever has it in the card, so a card that holds the
 * button that started the work (Save, Change password) must not use it: with `keepFocus` it stays
 * focusable and typing still works (what is half-typed stays where it is), but every click, including the one
 * a key press on a button makes, and every form submit, is swallowed in the capture phase, before any control
 * in the card sees it, so no second action can start against the stale data.
 */
export function refetchCardProps(refreshing: boolean, noticeable: boolean, keepFocus = false) {
  if (!refreshing) return {};
  const blocked = keepFocus ? { onClickCapture: swallow, onSubmitCapture: swallow } : { inert: true };
  return {
    className: noticeable ? "account-refetch account-refetch--dim" : "account-refetch",
    "aria-busy": true,
    ...blocked,
  };
}
