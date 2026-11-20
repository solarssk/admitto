import { describe, expect, it } from "vitest";
import type { BrandingTheme } from "@admitto/auth";
import { renderConfirmPage } from "../../src/registration/confirm-page.js";
import { renderRegistrationClosedPage, renderRegistrationFormPage } from "../../src/registration/form-page.js";
import { buildRegistrationPageStyles } from "../../src/registration/form-style.js";
import { registrationBrandingTheme } from "../../src/registration/registration-theme.js";
import { getRegistrationPageSecurityHeaders } from "../../src/registration-page-security.js";
import { buildTicketPageStyles } from "../../src/ticket-inline-styles.js";
import { closedModel, formModel } from "../helpers/registration-form-fixtures.js";

const family = (name: string, host: string) => ({
  name,
  variants: [{ weight: 400, style: "normal" as const, url: `https://${host}/a.woff2` }],
});

const THEME: BrandingTheme = {
  primary: "#111111",
  ticket_primary: "#222222",
  registration_primary: "#aa2200",
  font_family_name: "Admin Sans",
  ticket_font_family_name: "Ticket Sans",
  registration_font_family_name: "Form Sans",
  custom_font_families: [
    family("Admin Sans", "admin.example"),
    family("Ticket Sans", "ticket.example"),
    family("Form Sans", "form.example"),
  ],
};

describe("registrationBrandingTheme", () => {
  it("passes nothing through as it came", () => {
    expect(registrationBrandingTheme(null)).toBeNull();
    expect(registrationBrandingTheme()).toBeUndefined();
  });

  it("puts the form's own pick first, then the ticket page's", () => {
    expect(registrationBrandingTheme(THEME)).toMatchObject({
      ticket_primary: "#aa2200",
      ticket_font_family_name: "Form Sans",
      primary: "#111111",
      font_family_name: "Admin Sans",
    });
    expect(registrationBrandingTheme({ ticket_primary: "#222222", ticket_font_family_name: "Ticket Sans" })).toMatchObject({
      ticket_primary: "#222222",
      ticket_font_family_name: "Ticket Sans",
    });
  });
});

describe("the colour of the registration form", () => {
  it("is the form's own pick, then the ticket page's, then the admin's", () => {
    expect(buildRegistrationPageStyles(THEME)).toContain("--primary: #aa2200");
    expect(buildRegistrationPageStyles({ ...THEME, registration_primary: undefined })).toContain("--primary: #222222");
    expect(buildRegistrationPageStyles({ ...THEME, registration_primary: undefined, ticket_primary: undefined })).toContain(
      "--primary: #111111",
    );
  });

  it("does not change the ticket page", () => {
    const css = buildTicketPageStyles(THEME);
    expect(css).toContain("--primary: #222222");
    expect(css).not.toContain("#aa2200");
  });

  it("keeps the text on the button readable for a pale colour of the form", () => {
    const pale = buildRegistrationPageStyles({ ...THEME, registration_primary: "#f5c400" });
    expect(pale).toContain("--text-on-primary: #1d273b");
    expect(buildRegistrationPageStyles({ ...THEME, ticket_primary: "#f5c400", registration_primary: "#066fd1" })).not.toContain(
      "--text-on-primary: #1d273b",
    );
  });
});

describe("the font of the registration form", () => {
  it("is the form's own pick, then the ticket page's, then the admin's", () => {
    expect(buildRegistrationPageStyles(THEME)).toContain("form.example");
    const withoutOwn = buildRegistrationPageStyles({ ...THEME, registration_font_family_name: undefined });
    expect(withoutOwn).toContain("ticket.example");
    expect(withoutOwn).not.toContain("form.example");
    const adminOnly = buildRegistrationPageStyles({
      ...THEME,
      registration_font_family_name: undefined,
      ticket_font_family_name: undefined,
    });
    expect(adminOnly).toContain("admin.example");
  });

  it("loads only the family it uses, and a built-in one from the product's own files", () => {
    const css = buildRegistrationPageStyles(THEME);
    expect(css).not.toContain("ticket.example");
    expect(css).not.toContain("admin.example");
    expect(buildRegistrationPageStyles({ registration_font_family_name: "Manrope" })).toContain("/vendor/fontsource/manrope/");
  });

  it("is the same on the form, the closed page and the confirmation page", () => {
    const { event, contact } = formModel();
    const pages = [
      renderRegistrationFormPage(formModel(), { nonce: "n", theme: THEME }),
      renderRegistrationClosedPage(closedModel(), THEME),
      renderConfirmPage({ kind: "ask" }, { event, contact }, THEME),
    ];
    for (const html of pages) {
      expect(html).toContain("--primary: #aa2200");
      expect(html).toContain("form.example");
      expect(html).not.toContain("ticket.example");
    }
  });
});

describe("the security policy of the registration pages", () => {
  const fontSrc = (theme: BrandingTheme) =>
    /font-src ([^;]+)/.exec(getRegistrationPageSecurityHeaders("nonce", { turnstile: false, theme })["Content-Security-Policy"] ?? "")?.[1];

  it("allows the host of the form's own font, not the ticket page's or the admin's", () => {
    expect(fontSrc(THEME)).toBe("'self' https://form.example");
    expect(fontSrc({ ...THEME, registration_font_family_name: undefined })).toBe("'self' https://ticket.example");
  });

  it("allows only 'self' without a theme", () => {
    expect(getRegistrationPageSecurityHeaders("nonce", { turnstile: false })["Content-Security-Policy"]).toContain("font-src 'self';");
  });
});
