import { vi } from "vitest";

/**
 * The API calls and the toast of the Access tab, as mocks. A module of their own with no import of the app: a test file's `vi.mock` of
 * the client (or of `@admitto/ui`) loads it from its factory, and a module that imported the app there would import the module that is
 * being replaced.
 */
export const api = {
  fetchRegistrationSettings: vi.fn(),
  saveRegistrationSettings: vi.fn(),
  setRegistrationPassword: vi.fn(),
  clearRegistrationPassword: vi.fn(),
  fetchLegalDocuments: vi.fn(),
  fetchRegistrationCounts: vi.fn(),
};

export const addToast = vi.fn();
export const refreshEvent = vi.fn();
