/**
 * What a card needs while its data is refreshed after a change and stays on screen (AGENTS.md "Admin SPA
 * loading and busy states"): at once, nothing in it can be clicked or reached with the keyboard (`inert`,
 * so a second Revoke cannot start from the stale row), and it is marked busy; once the wait is noticeable
 * (`noticeable`, from `useLoadingGate`) it is also dimmed, so stale data does not look current. The class
 * also makes it the box the thin bar (`TopProgressBar placement="container"`) runs along.
 */
export function refetchCardProps(refreshing: boolean, noticeable: boolean) {
  if (!refreshing) return {};
  return {
    className: noticeable ? "account-refetch account-refetch--dim" : "account-refetch",
    inert: true,
    "aria-busy": true,
  };
}
