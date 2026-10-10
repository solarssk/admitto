import { vi } from "vitest";

/** Handles for the five api/client.js calls every ImportPage.*.test.tsx file wants individually controllable. Each test file
 * still registers its own vi.mock("../../src/api/client.js", ...): Vitest hoists that call by static analysis of the file it is
 * written in, so only the implementation is shared here (`buildImportApiMock`), not the registration. */
export const importApiMocks = {
  fetchEventCustomFields: vi.fn(),
  previewImport: vi.fn(),
  commitImport: vi.fn(),
  fetchImportJobStatus: vi.fn(),
  fetchImportHistory: vi.fn(),
};

/** The api/client.js mock body of the ImportPage tests: the real module (so ApiError always has its real shape) with the five
 * calls above wired to their handles. */
export function buildImportApiMock(actual: typeof import("../../src/api/client.js")) {
  return {
    ...actual,
    fetchEventCustomFields: (...args: unknown[]) => importApiMocks.fetchEventCustomFields(...args),
    previewImport: (...args: unknown[]) => importApiMocks.previewImport(...args),
    fetchImportHistory: (...args: unknown[]) => importApiMocks.fetchImportHistory(...args),
    commitImport: (...args: unknown[]) => importApiMocks.commitImport(...args),
    fetchImportJobStatus: (...args: unknown[]) => importApiMocks.fetchImportJobStatus(...args),
  };
}
