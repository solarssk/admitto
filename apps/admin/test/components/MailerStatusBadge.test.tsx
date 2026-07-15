// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MailerStatusBadge } from "../../src/components/MailerStatusBadge.js";

afterEach(cleanup);

describe("MailerStatusBadge", () => {
  it("renders nothing when status is null or undefined", () => {
    expect(render(<MailerStatusBadge status={null} />).container.firstChild).toBeNull();
    expect(render(<MailerStatusBadge status={undefined} />).container.firstChild).toBeNull();
  });

  it("shows a green mail icon with the provider name when configured", () => {
    const { container } = render(
      <MailerStatusBadge status={{ configured: true, provider: "smtp" }} />,
    );
    const badge = container.querySelector(".status-circle--ok");
    expect(badge).toBeTruthy();
    expect(badge?.getAttribute("aria-label")).toBe("Mailer configured (SMTP)");
    expect(badge?.getAttribute("data-tooltip")).toBe("Mailer configured (SMTP)");
    expect(badge?.getAttribute("role")).toBe("img");
    expect(container.querySelector(".ti-mail")).toBeTruthy();
  });

  it("shows a neutral mail-off icon when not configured", () => {
    const { container } = render(
      <MailerStatusBadge status={{ configured: false, provider: null }} />,
    );
    const badge = container.querySelector(".status-circle--neutral");
    expect(badge).toBeTruthy();
    expect(badge?.getAttribute("aria-label")).toBe("Mailer not configured");
    expect(container.querySelector(".ti-mail-off")).toBeTruthy();
  });

  it("falls back to the raw provider string for an unrecognized provider", () => {
    const { container } = render(
      // @ts-expect-error — exercising the unknown-provider fallback branch
      <MailerStatusBadge status={{ configured: true, provider: "custom_relay" }} />,
    );
    expect(container.querySelector(".status-circle")?.getAttribute("aria-label")).toBe(
      "Mailer configured (custom_relay)",
    );
  });

  it("shows an em dash when configured but no provider is set", () => {
    const { container } = render(<MailerStatusBadge status={{ configured: true, provider: null }} />);
    expect(container.querySelector(".status-circle")?.getAttribute("aria-label")).toBe(
      "Mailer configured (—)",
    );
  });
});
