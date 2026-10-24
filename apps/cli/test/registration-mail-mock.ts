import { vi } from "vitest";

/** The registration mail exports of @admitto/mail-delivery for a test that mocks the package: a queue with nothing in it. */
export const registrationMailMock = {
  DEFAULT_REGISTRATION_MAIL_DRAIN_LIMIT: 20,
  drainRegistrationMails: vi.fn(async () => ({ claimed: 0, sent: 0, failed: 0, cancelled: 0, skipped: 0, eventIds: [] as string[] })),
  sweepExpiredRegistrations: vi.fn(async () => ({ deleted: 0, eventIds: [] as string[], more: false })),
};
