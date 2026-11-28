import type { BrandingTheme } from "@admitto/auth";

/**
 * The branding theme as the guest registration pages see it. The registration form and its confirmation page have their
 * own colour and font (`registration_primary`, `registration_font_family_name`); each falls back to the ticket page's pick,
 * then to the admin's. The ticket page code already resolves "ticket pick, else admin pick", so the registration pick is
 * written into the ticket slots: the stylesheet, the contrast rule on the button and the font part of the security policy
 * then work unchanged, and for the form and the confirmation page one rule decides the order.
 */
export function registrationBrandingTheme(theme?: BrandingTheme | null): BrandingTheme | null | undefined {
  if (!theme) return theme;
  return {
    ...theme,
    ticket_primary: theme.registration_primary ?? theme.ticket_primary,
    ticket_font_family_name: theme.registration_font_family_name ?? theme.ticket_font_family_name,
  };
}
