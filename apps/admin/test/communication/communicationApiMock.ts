import { vi } from "vitest";

/** Handles for the five api/client.js calls every CommunicationPage.*.test.tsx file wants
 * individually controllable - which template loads (fetchEventTemplates/fetchEventTemplate/
 * fetchEventTemplateById) and the two the bounce banner/delivery log tab need
 * (fetchEventOverview/fetchEventDeliveries). Each test file still registers its own local
 * vi.mock("../../src/api/client.js", ...) - Vitest's mock hoisting is a per-file static-analysis
 * transform that only sees calls written in the importing file's own source, so this can share
 * the mock *implementation* but not the registration itself - building off
 * buildCommunicationApiMock() below and layering in only the extra functions its own scenario
 * needs to control. */
export const communicationApiMocks = {
  fetchEventTemplates: vi.fn(),
  fetchEventTemplate: vi.fn(),
  fetchEventTemplateById: vi.fn(),
  fetchEventOverview: vi.fn(),
  fetchEventDeliveries: vi.fn(),
};

/** Base api/client.js mock body shared by every CommunicationPage.*.test.tsx file - spreads the
 * real module (so ApiError/TemplateValidationError always track their actual shape, no hand-rolled
 * fake class to keep in sync) and wires the five commonly-controlled calls above. Everything else
 * defaults to an inert stub or a resolved empty value that no test here cares about; a file that
 * needs one of those individually controllable (e.g. templates.test.tsx driving create/delete/
 * preview/send) overrides that key in its own factory on top of this spread. */
export function buildCommunicationApiMock(actual: typeof import("../../src/api/client.js")) {
  return {
    ...actual,
    fetchEventTemplates: (...args: unknown[]) => communicationApiMocks.fetchEventTemplates(...args),
    fetchEventTemplate: (...args: unknown[]) => communicationApiMocks.fetchEventTemplate(...args),
    fetchEventTemplateById: (...args: unknown[]) =>
      communicationApiMocks.fetchEventTemplateById(...args),
    fetchEventOverview: (...args: unknown[]) => communicationApiMocks.fetchEventOverview(...args),
    fetchEventDeliveries: (...args: unknown[]) => communicationApiMocks.fetchEventDeliveries(...args),
    // The Send/Templates tabs auto-render a preview on mount - resolved by default so that isn't
    // an unrelated "Preview failed" toast in tests that never cared about preview content.
    previewEventTemplate: vi.fn().mockResolvedValue({ subject: "", html: "" }),
    previewEventTemplateById: vi.fn().mockResolvedValue({ subject: "", html: "" }),
    saveEventTemplate: vi.fn(),
    saveEventTemplateById: vi.fn(),
    createEventTemplate: vi.fn(),
    deleteEventTemplate: vi.fn(),
    updateEventTemplateMetadata: vi.fn(),
    testSendEventTemplate: vi.fn(),
    testSendEventTemplateById: vi.fn(),
    sendEventBulk: vi.fn(),
    fetchBulkSendStatus: vi.fn(),
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
    fetchEventMailSettings: vi.fn().mockResolvedValue({
      fields: { fromName: { value: null }, fromAddress: { value: null } },
    }),
  };
}
