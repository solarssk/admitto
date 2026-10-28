import type {
  EventDto,
  RegistrationCountsDto,
  RegistrationDetailDto,
  RegistrationListDto,
  RegistrationListItemDto,
  RegistrationMailDto,
} from "../../src/api/types.js";

/**
 * The data the tests of the Requests tab share: the event, the requests and the numbers they read. Kept apart from the render helpers
 * (requestsFixtures.tsx) because it must import nothing that reaches the mocked API: the mock of the API is built from requestsApi.tsx,
 * which builds its answers from this file.
 */
export const EVENT = { id: "evt-1", title: "Demo", slug: "demo", archived_at: null, timezone: "Europe/Warsaw" } as EventDto;

export function request(id: string, over: Partial<RegistrationListItemDto> = {}): RegistrationListItemDto {
  return {
    id,
    first_name: "Ann",
    last_name: "Kowalska",
    email: `${id}@example.com`,
    company: null,
    department: null,
    status: "pending",
    created_at: "2026-10-23T10:14:00.000Z",
    companions_count: 0,
    last_mail: null,
    ...over,
  };
}

/** A person's name for a request, so a test can tell the rows apart by what they say. */
export function named(id: string, first: string, last: string, over: Partial<RegistrationListItemDto> = {}): RegistrationListItemDto {
  return request(id, { first_name: first, last_name: last, ...over });
}

export function answer(
  items: RegistrationListItemDto[],
  total = items.length,
  page = 1,
  pageSize = 25,
  over: Partial<RegistrationListDto> = {},
): RegistrationListDto {
  return { items, total, page, pageSize, selection_digest: null, ...over };
}

export function counts(
  byStatus: Partial<RegistrationCountsDto["by_status"]> = {},
  mode: RegistrationCountsDto["mode"] = "approval",
): RegistrationCountsDto {
  return {
    mode,
    by_status: { awaiting_email: 0, pending: 0, waitlist: 0, accepted: 0, rejected: 0, ...byStatus },
    needs_decision: byStatus.pending ?? 0,
  };
}

/** A failed email that staff may send again, as the list says it. */
export const FAILED_MAIL = { template_name: "registration-received", status: "failed", retryable: false, can_retry: true } as const;

export function mailRow(id: string, over: Partial<RegistrationMailDto> = {}): RegistrationMailDto {
  return {
    id,
    template_name: "registration-received",
    status: "sent",
    retryable: null,
    can_retry: false,
    attempts: 1,
    queued_at: "2026-10-23T10:15:00.000Z",
    attempted_at: "2026-10-23T10:15:30.000Z",
    sent_at: "2026-10-23T10:15:31.000Z",
    error_code: null,
    error: null,
    ...over,
  };
}

/** One request in full, as the detail answers it. */
export function detail(id: string, over: Partial<RegistrationDetailDto> = {}): RegistrationDetailDto {
  return {
    id,
    status: "pending",
    email: `${id}@example.com`,
    first_name: "Ann",
    last_name: "Kowalska",
    company: null,
    department: null,
    custom_data: null,
    companions: [],
    created_at: "2026-10-23T10:14:00.000Z",
    email_verified_at: "2026-10-23T10:16:00.000Z",
    confirm_expires_at: null,
    accepted_at: "2026-10-23T10:14:00.000Z",
    consents: {},
    decided_at: null,
    decided_by: null,
    locale: null,
    attendee_id: null,
    mails: [mailRow(`${id}-mail`)],
    ...over,
  };
}
