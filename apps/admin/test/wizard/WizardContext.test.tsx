// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  sanitizePersistedSummary,
  useWizard,
  WIZARD_CONTEXT_STORAGE_KEY,
  WizardProvider,
} from "../../src/pages/wizard/WizardContext.js";

function WizardProbe() {
  const { summary, mailSkipped, selectedEventId } = useWizard();
  return (
    <div>
      <span data-testid="mail">{summary.mailLabel}</span>
      <span data-testid="branding">{summary.brandingLabel}</span>
      <span data-testid="event">{summary.eventTitle ?? ""}</span>
      <span data-testid="mail-skipped">{String(mailSkipped)}</span>
      <span data-testid="event-id">{selectedEventId ?? ""}</span>
    </div>
  );
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("sanitizePersistedSummary", () => {
  it("returns defaults for non-object values", () => {
    expect(sanitizePersistedSummary(null).mailLabel).toBe("Skipped");
    expect(sanitizePersistedSummary("bad").brandingLabel).toBe("Skipped");
    expect(sanitizePersistedSummary([]).eventTitle).toBe(null);
  });

  it("keeps valid strings and coerces invalid field types", () => {
    expect(
      sanitizePersistedSummary({
        mailLabel: "Configured (SMTP)",
        brandingLabel: "Logo set",
        eventTitle: "Summit",
      }),
    ).toEqual({
      mailLabel: "Configured (SMTP)",
      brandingLabel: "Logo set",
      eventTitle: "Summit",
    });

    expect(sanitizePersistedSummary({ mailLabel: 42, eventTitle: 99 })).toEqual({
      mailLabel: "Skipped",
      brandingLabel: "Skipped",
      eventTitle: null,
    });
  });
});

describe("WizardProvider session restore", () => {
  it("hydrates context from sessionStorage with sanitized summary", () => {
    sessionStorage.setItem(
      WIZARD_CONTEXT_STORAGE_KEY,
      JSON.stringify({
        selectedEventId: "evt-abc",
        mailSkipped: true,
        brandingSkipped: false,
        summary: { mailLabel: 123, brandingLabel: "Acme", eventTitle: null },
      }),
    );

    render(
      <WizardProvider>
        <WizardProbe />
      </WizardProvider>,
    );

    expect(screen.getByTestId("mail").textContent).toBe("Skipped");
    expect(screen.getByTestId("branding").textContent).toBe("Acme");
    expect(screen.getByTestId("mail-skipped").textContent).toBe("true");
    expect(screen.getByTestId("event-id").textContent).toBe("evt-abc");
  });

  it("ignores corrupt sessionStorage JSON", () => {
    sessionStorage.setItem(WIZARD_CONTEXT_STORAGE_KEY, "{not-json");

    render(
      <WizardProvider>
        <WizardProbe />
      </WizardProvider>,
    );

    expect(screen.getByTestId("mail").textContent).toBe("Skipped");
    expect(screen.getByTestId("event-id").textContent).toBe("");
  });
});
