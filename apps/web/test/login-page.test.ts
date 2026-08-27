import { describe, expect, it } from "vitest";
import { renderLoginForm, renderOperatorLanding } from "../src/login-page.js";

describe("login page rendering", () => {
  it("omits the SSO next query when there is no target path", () => {
    const html = renderLoginForm("test-nonce", undefined, undefined, [
      { id: "contoso", button_label: "Contoso SSO" },
    ]);

    expect(html).toContain('href="/api/auth/oidc/contoso/start"');
    expect(html).not.toContain("/start?next=");
  });

  it("renders an SSO target with an encoded next path", () => {
    const html = renderLoginForm("test-nonce", undefined, "/operator?tab=checkin", [
      { id: "contoso", button_label: "Contoso SSO" },
    ]);

    expect(html).toContain(
      'href="/api/auth/oidc/contoso/start?next=%2Foperator%3Ftab%3Dcheckin"',
    );
  });

  it("includes a hidden timezone field and capture script for local login and SSO", () => {
    const html = renderLoginForm("test-nonce", undefined, undefined, [
      { id: "contoso", button_label: "Contoso SSO" },
    ]);

    expect(html).toContain('name="timezone"');
    expect(html).toContain("resolvedOptions().timeZone");
    expect(html).toContain("auth-btn-sso");
    expect(html).toContain('searchParams.set("tz"');
  });

  it("omits the passkey sign-in button by default", () => {
    const html = renderLoginForm("test-nonce");
    expect(html).not.toContain("passkey-login-btn");
  });

  it("renders a hidden passkey sign-in button, alongside SSO in the same list, when enabled", () => {
    const html = renderLoginForm("test-nonce", undefined, undefined, [
      { id: "contoso", button_label: "Contoso SSO" },
    ], true);

    expect(html).toContain('id="passkey-login-btn" hidden');
    expect(html.match(/id="passkey-login-error" hidden/g)).toHaveLength(1);
    // Single shared list/divider markup in the body, not one per button type
    // (AUTH_PAGE_CSS's embedded stylesheet also defines these class names once).
    expect(html.match(/<div class="auth-sso-list" id="auth-alt-signin-list">/g)).toHaveLength(1);
    expect(html.match(/<div class="auth-divider" id="auth-alt-signin-divider">/g)).toHaveLength(1);
    const listStart = html.indexOf('<div class="auth-sso-list"');
    const ssoAnchor = html.indexOf('class="auth-btn-secondary auth-btn-sso"');
    expect(html.indexOf("passkey-login-btn")).toBeGreaterThan(listStart);
    expect(html.indexOf("passkey-login-btn")).toBeLessThan(ssoAnchor);
  });

  it("hides the shared list/divider on unsupported browsers when no SSO buttons are present", () => {
    const html = renderLoginForm("test-nonce", undefined, undefined, [], true);
    expect(html).toContain('id="auth-alt-signin-list"');
    expect(html).toContain('id="auth-alt-signin-divider"');
    expect(html).toContain('list.querySelector(".auth-btn-sso")');
  });

  it("carries the next path on the passkey button for the client script to forward", () => {
    const html = renderLoginForm("test-nonce", undefined, "/operator?tab=checkin", [], true);
    expect(html).toContain('data-next="/operator?tab=checkin"');
  });

  it("still renders the shared divider for passkey-only (no SSO providers)", () => {
    const html = renderLoginForm("test-nonce", undefined, undefined, [], true);
    expect(html).toContain('id="passkey-login-btn"');
    expect(html).toContain("auth-divider");
  });

  it("escapes operator event rows before rendering them", () => {
    const html = renderOperatorLanding("operator@example.com", [
      { title: "Welcome & check-in", slug: "summer<gala>" },
    ]);

    expect(html).toContain("Welcome &amp; check-in");
    expect(html).toContain("summer&lt;gala&gt;");
  });
});
