import type { SyntheticEvent } from "react";

const swallow = (event: SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

/**
 * What a card needs while its data is refreshed after a change and stays on screen (AGENTS.md "Admin SPA
 * loading and busy states"). While it is refreshing (`refreshing`) nothing in it can be used (see below) and it is
 * marked busy. Once the wait is noticeable (`noticeable`, from `useLoadingGate`, which also keeps it for at least
 * 400ms) it is dimmed, so stale data does not look current, and the thin bar (`TopProgressBar
 * placement="container"`) runs along its top; the `refetch-card` class is the box that bar is positioned in, so
 * it stays for as long as the bar does, which can be a little longer than the refresh.
 *
 * Keys are stopped too, one of two ways. By default the card is `inert`: nothing in it can be focused or
 * activated. `inert` also takes keyboard focus off whatever has it in the card, so a card that holds the
 * button that started the work (Save, Change password) must not use it: with `keepFocus` it stays
 * focusable and typing still works (what is half-typed stays where it is), but every click, including the one
 * a key press on a button makes, and every form submit, is swallowed in the capture phase, before any control
 * in the card sees it, so no second action can start against the stale data.
 */
export function refetchCardProps(refreshing: boolean, noticeable: boolean, keepFocus = false) {
  if (!refreshing && !noticeable) return {};
  const classes = ["refetch-card"];
  if (refreshing) classes.push("refetch-card--busy");
  if (noticeable) classes.push("refetch-card--dim");
  if (!refreshing) return { className: classes.join(" ") };
  const blocked = keepFocus ? { onClickCapture: swallow, onSubmitCapture: swallow } : { inert: true };
  return { className: classes.join(" "), "aria-busy": true, ...blocked };
}
