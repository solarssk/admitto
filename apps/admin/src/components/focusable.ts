/** Query selector for interactively focusable elements — shared by the modal focus trap and
 * the dropdown-menu hook so both agree on what counts as "the first focusable control". */
export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
