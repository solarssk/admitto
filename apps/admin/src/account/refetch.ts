/**
 * What a card needs while its data is refreshed after a change and stays on screen (AGENTS.md "Admin SPA
 * loading and busy states"): at once, nothing in it can be clicked (the `account-refetch` class), and it is
 * marked busy; once the wait is noticeable (`noticeable`, from `useLoadingGate`) it is also dimmed, so stale
 * data does not look current. The class also makes it the box the thin bar (`TopProgressBar
 * placement="container"`) runs along.
 *
 * `blockKeys` also makes it `inert`, so no key reaches it either. Use it only for a card whose actions open
 * their dialog elsewhere on the page (the sessions list): `inert` takes keyboard focus off whatever has it in
 * the card, so a card that holds the button that started the work (Save, Change password) must not have it.
 */
export function refetchCardProps(refreshing: boolean, noticeable: boolean, blockKeys = true) {
  if (!refreshing) return {};
  return {
    className: noticeable ? "account-refetch account-refetch--dim" : "account-refetch",
    inert: blockKeys || undefined,
    "aria-busy": true,
  };
}
