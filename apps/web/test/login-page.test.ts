import { describe, expect, it } from "vitest";
import { renderLoginForm, renderOperatorLanding } from "../src/login-page.js";

describe("login page rendering", () => {
  it("renders an SSO target with an encoded next path", () => {
    const html = renderLoginForm("test-nonce", undefined, "/operator?tab=checkin", [
      { id: "contoso", button_label: "Contoso SSO" },
    ]);

    expect(html).toContain(
      'href="/api/auth/oidc/contoso/start?next=%2Foperator%3Ftab%3Dcheckin"',
    );
  });

  it("escapes operator event rows before rendering them", () => {
    const html = renderOperatorLanding("operator@example.com", [
      { title: "Welcome & check-in", slug: "summer<gala>" },
    ]);

    expect(html).toContain("Welcome &amp; check-in");
    expect(html).toContain("summer&lt;gala&gt;");
  });
});
