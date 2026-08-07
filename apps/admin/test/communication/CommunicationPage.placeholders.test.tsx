// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";
import { renderWithToast } from "../test-utils.js";

const fetchEventTemplates = vi.fn();
const fetchEventTemplate = vi.fn();
const fetchEventTemplateById = vi.fn();
const fetchEventOverview = vi.fn();
const fetchEventDeliveries = vi.fn();

const reportApiError = vi.fn();

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError }),
}));

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  TemplateValidationError: class TemplateValidationError extends Error {},
  fetchEventTemplates: (...args: unknown[]) => fetchEventTemplates(...args),
  fetchEventTemplate: (...args: unknown[]) => fetchEventTemplate(...args),
  fetchEventTemplateById: (...args: unknown[]) => fetchEventTemplateById(...args),
  fetchEventOverview: (...args: unknown[]) => fetchEventOverview(...args),
  fetchEventDeliveries: (...args: unknown[]) => fetchEventDeliveries(...args),
  previewEventTemplate: vi.fn(),
  previewEventTemplateById: vi.fn(),
  saveEventTemplate: vi.fn(),
  saveEventTemplateById: vi.fn(),
  createEventTemplate: vi.fn(),
  deleteEventTemplate: vi.fn(),
  testSendEventTemplate: vi.fn(),
  testSendEventTemplateById: vi.fn(),
  sendEventBulk: vi.fn(),
  fetchBulkSendStatus: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked" as const, proceed: vi.fn(), reset: vi.fn() }),
    useOutletContext: () => ({
      event: { id: "evt-1", title: "Demo", archived_at: null },
    }),
  };
});

const legacyTemplate = {
  source: "builtin" as const,
  allowed_placeholders: ["first_name", "logo_url"],
  required_url_placeholders: [],
  image_placeholders: ["logo_url"],
  subject_template: "Hello",
  body_template: "<p>Hi</p>",
  template_format: "mjml" as const,
};

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-comm/communication?tab=templates"]}>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Focuses `el` and places the cursor at the very end of its current value, so a chip click's
 * insertion point is deterministic regardless of jsdom's default (unset) selection state. */
function focusAtEnd(el: HTMLInputElement | HTMLTextAreaElement) {
  fireEvent.focus(el);
  el.setSelectionRange(el.value.length, el.value.length);
}

beforeEach(() => {
  fetchEventOverview.mockResolvedValue({
    email_bounced: 0,
    email_failed: 0,
    email_sent: 0,
    email_queued: 0,
  });
  fetchEventTemplates.mockResolvedValue([]);
  fetchEventTemplate.mockResolvedValue(legacyTemplate);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchEventTemplates.mockReset();
  fetchEventTemplate.mockReset();
});

// Regression coverage for a real bug: clicking a placeholder chip reads and writes the DOM
// element's value/selection synchronously (see `insertTokenIntoField` in CommunicationPage.tsx).
// Before that fix, rapid repeated clicks read a stale cursor position and a stale `body`/
// `subject` state closure, so a second/third click could land at the exact same spot as the
// first — silently overwriting it or splicing new markup into the middle of the previous
// insertion's attributes (observed live as nested, invalid MJML like
// `<mj-image src="<mj-image src="{{logo2}}" ...`).
describe("CommunicationPage placeholder chip insertion", () => {
  it("appends repeated clicks on the same image chip as separate, well-formed elements instead of overwriting or nesting them", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("MJML body")).toBeTruthy();
    });

    const bodyTextarea = screen.getByLabelText("MJML body") as HTMLTextAreaElement;
    focusAtEnd(bodyTextarea);

    const chip = screen.getByRole("button", { name: "{{logo_url}}" });
    // Fire 3 clicks back-to-back, with no `await`/act flush in between — the fastest possible
    // repeated click a test can express, standing in for "faster than a browser can repaint".
    fireEvent.click(chip);
    fireEvent.click(chip);
    fireEvent.click(chip);

    const oneImage = '<mj-image src="{{logo_url}}" alt="Logo" width="200px" />';
    expect(bodyTextarea.value).toBe(`<p>Hi</p>${oneImage}${oneImage}${oneImage}`);
  });

  it("appends repeated clicks on a plain-text placeholder chip sequentially, not overwriting", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("MJML body")).toBeTruthy();
    });

    const bodyTextarea = screen.getByLabelText("MJML body") as HTMLTextAreaElement;
    focusAtEnd(bodyTextarea);

    const chip = screen.getByRole("button", { name: "{{first_name}}" });
    fireEvent.click(chip);
    fireEvent.click(chip);

    expect(bodyTextarea.value).toBe("<p>Hi</p>{{first_name}}{{first_name}}");
  });

  it("always inserts a bare token in Subject, even for an image placeholder", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });

    const subjectInput = screen.getByLabelText("Subject") as HTMLInputElement;
    focusAtEnd(subjectInput);

    const chip = screen.getByRole("button", { name: "{{logo_url}}" });
    fireEvent.click(chip);

    expect(subjectInput.value).toBe("Hello{{logo_url}}");
  });
});

// Regression coverage for a real bug found via live-browser testing: MJML silently discards any
// markup that ends up outside the `<mjml>...</mjml>` root — no error, no warning, it just never
// reaches the compiled preview/email. This happens whenever a chip is clicked before the textarea
// has ever been focused: the browser then reports selectionStart/End as 0 (the very start of the
// raw text), which sits *before* `<mjml>` opens. `insertTokenIntoField` now detects this and
// redirects the insertion to just before the last `</mj-column>` instead, wrapping bare tokens in
// their own `<mj-text>` (loose text between components is just as silently dropped as content
// outside the root).
describe("CommunicationPage placeholder chip insertion outside the <mjml> root", () => {
  const mjmlTemplate = {
    source: "builtin" as const,
    allowed_placeholders: ["first_name", "logo_url"],
    required_url_placeholders: [],
    image_placeholders: ["logo_url"],
    subject_template: "Hello",
    body_template:
      '<mjml><mj-body><mj-section><mj-column><mj-text>{{event_name}}</mj-text></mj-column></mj-section></mj-body></mjml>',
    template_format: "mjml" as const,
  };

  it("redirects an image chip click to inside <mj-column> when the body was never focused (cursor defaults to 0, before <mjml>)", async () => {
    fetchEventTemplate.mockResolvedValue(mjmlTemplate);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("MJML body")).toBeTruthy();
    });

    // Deliberately do NOT focus the textarea — this is the exact scenario that produced the bug:
    // the user's first action on the page is clicking a placeholder chip, so the browser's
    // default (unset) selectionStart/End of 0 would otherwise place new markup before <mjml>.
    const chip = screen.getByRole("button", { name: "{{logo_url}}" });
    fireEvent.click(chip);

    const bodyTextarea = screen.getByLabelText("MJML body") as HTMLTextAreaElement;
    expect(bodyTextarea.value).toBe(
      '<mjml><mj-body><mj-section><mj-column><mj-text>{{event_name}}</mj-text>' +
        '<mj-image src="{{logo_url}}" alt="Logo" width="200px" /></mj-column></mj-section></mj-body></mjml>',
    );
  });

  it("redirects a plain-text chip click the same way, wrapping the bare token in its own <mj-text>", async () => {
    fetchEventTemplate.mockResolvedValue(mjmlTemplate);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("MJML body")).toBeTruthy();
    });

    const chip = screen.getByRole("button", { name: "{{first_name}}" });
    fireEvent.click(chip);

    const bodyTextarea = screen.getByLabelText("MJML body") as HTMLTextAreaElement;
    expect(bodyTextarea.value).toBe(
      '<mjml><mj-body><mj-section><mj-column><mj-text>{{event_name}}</mj-text>' +
        "<mj-text>{{first_name}}</mj-text></mj-column></mj-section></mj-body></mjml>",
    );
  });

  it("does not redirect when the cursor is already inside the <mjml> root (normal usage is unaffected)", async () => {
    fetchEventTemplate.mockResolvedValue(mjmlTemplate);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("MJML body")).toBeTruthy();
    });

    const bodyTextarea = screen.getByLabelText("MJML body") as HTMLTextAreaElement;
    // Place the cursor right after "{{event_name}}", genuinely inside <mj-column>/<mj-text> —
    // not at the very end of the whole string, which for this fixture sits right after </mjml>
    // (i.e. outside the root, a different case covered by the next test).
    fireEvent.focus(bodyTextarea);
    const insideRootPos = bodyTextarea.value.indexOf("{{event_name}}") + "{{event_name}}".length;
    bodyTextarea.setSelectionRange(insideRootPos, insideRootPos);

    const chip = screen.getByRole("button", { name: "{{first_name}}" });
    fireEvent.click(chip);

    // Cursor was already inside the root, so the token lands right there, exactly where the user
    // placed it — no redirect kicks in when the position is already valid.
    expect(bodyTextarea.value).toBe(
      '<mjml><mj-body><mj-section><mj-column><mj-text>{{event_name}}{{first_name}}</mj-text></mj-column></mj-section></mj-body></mjml>',
    );
  });

  // Regression (bot review): <mj-image> is not a valid child of <mj-text> — MJML rejects the
  // nested markup at compile time. Being inside a <mj-column> was previously treated as always
  // safe, but an image chip clicked from inside an existing <mj-text> paragraph needs its own
  // redirect, unlike a bare token (which belongs inside <mj-text> just fine).
  it("redirects an image chip click out of an existing <mj-text>, instead of nesting <mj-image> inside it", async () => {
    fetchEventTemplate.mockResolvedValue(mjmlTemplate);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("MJML body")).toBeTruthy();
    });

    const bodyTextarea = screen.getByLabelText("MJML body") as HTMLTextAreaElement;
    // Cursor genuinely inside the existing <mj-text>{{event_name}}</mj-text> — same position the
    // previous test used for a bare token, where inserting in place is correct.
    fireEvent.focus(bodyTextarea);
    const insideTextPos = bodyTextarea.value.indexOf("{{event_name}}") + "{{event_name}}".length;
    bodyTextarea.setSelectionRange(insideTextPos, insideTextPos);

    const chip = screen.getByRole("button", { name: "{{logo_url}}" });
    fireEvent.click(chip);

    // Must land after </mj-text>, inside <mj-column> but not nested inside the <mj-text> — not
    // '<mj-text>{{event_name}}<mj-image .../></mj-text>', which MJML would reject.
    expect(bodyTextarea.value).toBe(
      '<mjml><mj-body><mj-section><mj-column><mj-text>{{event_name}}</mj-text>' +
        '<mj-image src="{{logo_url}}" alt="Logo" width="200px" /></mj-column></mj-section></mj-body></mjml>',
    );
  });

  // Regression (bot review): filling in an existing image element's src (a common edit — the
  // admin placed an <mj-image> earlier and now wants to pick its source) must insert the bare
  // token right there, not a second whole <mj-image> element nested inside the attribute value.
  it("inserts the bare token when the cursor is inside an existing attribute value, not a full image element", async () => {
    fetchEventTemplate.mockResolvedValue({
      ...mjmlTemplate,
      body_template:
        '<mjml><mj-body><mj-section><mj-column><mj-image src="" alt="Logo" /></mj-column></mj-section></mj-body></mjml>',
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("MJML body")).toBeTruthy();
    });

    const bodyTextarea = screen.getByLabelText("MJML body") as HTMLTextAreaElement;
    fireEvent.focus(bodyTextarea);
    const insideSrcPos = bodyTextarea.value.indexOf('src="') + 'src="'.length;
    bodyTextarea.setSelectionRange(insideSrcPos, insideSrcPos);

    const chip = screen.getByRole("button", { name: "{{logo_url}}" });
    fireEvent.click(chip);

    // Bare {{logo_url}} filled into the existing src="" — not a second <mj-image> spliced inside
    // the attribute value, which would produce unparsable, uncompilable markup.
    expect(bodyTextarea.value).toBe(
      '<mjml><mj-body><mj-section><mj-column><mj-image src="{{logo_url}}" alt="Logo" /></mj-column></mj-section></mj-body></mjml>',
    );
  });

  it("redirects when the cursor sits after </mjml> (e.g. clicking at the very end of a template with no trailing content)", async () => {
    fetchEventTemplate.mockResolvedValue(mjmlTemplate);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("MJML body")).toBeTruthy();
    });

    const bodyTextarea = screen.getByLabelText("MJML body") as HTMLTextAreaElement;
    focusAtEnd(bodyTextarea);

    const chip = screen.getByRole("button", { name: "{{first_name}}" });
    fireEvent.click(chip);

    expect(bodyTextarea.value).toBe(
      '<mjml><mj-body><mj-section><mj-column><mj-text>{{event_name}}</mj-text>' +
        "<mj-text>{{first_name}}</mj-text></mj-column></mj-section></mj-body></mjml>",
    );
  });

  // Regression coverage: `isWithinMjmlRoot` alone only checks whether the cursor sits between
  // `<mjml>` and `</mjml>` — it says nothing about whether that position is inside a text-capable
  // container. A cursor placed right after `</mj-section>` (still "within root", but between
  // components, not inside any `<mj-column>`) used to fall through with no redirect, inserting a
  // bare `{{token}}` as a loose text node that MJML silently drops. `isInsideMjColumn` closes
  // that gap.
  it("redirects a chip click when the cursor sits between components inside the <mjml> root (e.g. right after </mj-section>, before </mj-body>)", async () => {
    fetchEventTemplate.mockResolvedValue(mjmlTemplate);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("MJML body")).toBeTruthy();
    });

    const bodyTextarea = screen.getByLabelText("MJML body") as HTMLTextAreaElement;
    fireEvent.focus(bodyTextarea);
    const afterSectionPos = bodyTextarea.value.indexOf("</mj-section>") + "</mj-section>".length;
    bodyTextarea.setSelectionRange(afterSectionPos, afterSectionPos);

    const chip = screen.getByRole("button", { name: "{{first_name}}" });
    fireEvent.click(chip);

    // Must redirect into the last <mj-column>, wrapped in its own <mj-text> — same as the
    // outside-root cases above — not land as loose text between </mj-section> and </mj-body>.
    expect(bodyTextarea.value).toBe(
      '<mjml><mj-body><mj-section><mj-column><mj-text>{{event_name}}</mj-text>' +
        "<mj-text>{{first_name}}</mj-text></mj-column></mj-section></mj-body></mjml>",
    );
  });

  it("leaves insertion untouched for a template with no <mj-column> to redirect into (no safe fallback available)", async () => {
    fetchEventTemplate.mockResolvedValue({
      ...mjmlTemplate,
      body_template: '<mj-text>orphan</mj-text><mjml><mj-body></mj-body></mjml>',
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("MJML body")).toBeTruthy();
    });

    const chip = screen.getByRole("button", { name: "{{first_name}}" });
    fireEvent.click(chip);

    const bodyTextarea = screen.getByLabelText("MJML body") as HTMLTextAreaElement;
    // No </mj-column> exists anywhere, so there's no safe place to redirect to — falls back to
    // the original (still bug-prone, but no worse than before this fix) raw cursor position.
    expect(bodyTextarea.value).toBe(
      '{{first_name}}<mj-text>orphan</mj-text><mjml><mj-body></mj-body></mjml>',
    );
  });
});

// Regression: header_image_url has no organisation-level branding field to fall back to (org
// branding only manages a logo) and the per-event override was intentionally dropped in favour
// of the general-purpose image asset library, so it's unreachable through any UI — offering it as
// an insertable chip would always produce a permanently empty image with no way to fill it in.
describe("CommunicationPage placeholder chip list", () => {
  it("never offers header_image_url as an insertable chip even when the server includes it in allowed_placeholders", async () => {
    fetchEventTemplate.mockResolvedValue({
      ...legacyTemplate,
      allowed_placeholders: ["first_name", "logo_url", "header_image_url"],
      image_placeholders: ["logo_url", "header_image_url"],
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("MJML body")).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "{{logo_url}}" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "{{header_image_url}}" })).toBeNull();
  });

  it("inserts event_map_url with Event location map alt text", async () => {
    fetchEventTemplate.mockResolvedValue({
      ...legacyTemplate,
      allowed_placeholders: ["first_name", "event_map_url"],
      image_placeholders: ["event_map_url"],
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("MJML body")).toBeTruthy();
    });

    const bodyTextarea = screen.getByLabelText("MJML body") as HTMLTextAreaElement;
    focusAtEnd(bodyTextarea);
    fireEvent.click(screen.getByRole("button", { name: "{{event_map_url}}" }));

    expect(bodyTextarea.value).toContain(
      '<mj-image src="{{event_map_url}}" alt="Event location map" width="200px" />',
    );
  });
});
