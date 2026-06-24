/** Whether a Settings horizontal tab should show as active for the current path. */
export function isSettingsSubnavActive(pathname: string, href: string): boolean {
  if (href === "/admin/settings") {
    return pathname === "/admin/settings";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
