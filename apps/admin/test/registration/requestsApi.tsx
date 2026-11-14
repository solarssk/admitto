import { createHash } from "node:crypto";
import { vi } from "vitest";
import type {
  AcceptRegistrationsDto,
  DeleteRegistrationsByFilterBody,
  DeleteRegistrationsDto,
  RegistrationCountsDto,
  RegistrationListDto,
  RegistrationListItemDto,
  RegistrationListParams,
  RejectRegistrationsDto,
  RetryRegistrationMailsDto,
} from "../../src/api/types.js";
import { answer, counts, detail } from "./requestsData.js";

// The real class, not the mocked module's own door to it: what the code under test checks with `instanceof` is this one.
const { ApiError } = await vi.importActual<typeof import("../../src/api/client.js")>("../../src/api/client.js");

/**
 * The API of the Requests tab as its tests mock it: one handle for each function, and the factories that put them in place of the
 * real ones (`vi.mock("../../src/api/client.js", async () => (await import("./requestsApi.js")).mockedClient())`, written in each
 * test file, since a `vi.mock` only works where it is written).
 */
export const api = {
  fetchRegistrations: vi.fn(),
  fetchRegistrationCounts: vi.fn(),
  fetchRegistration: vi.fn(),
  acceptRegistrations: vi.fn(),
  rejectRegistrations: vi.fn(),
  retryRegistrationMails: vi.fn(),
  deleteRegistrations: vi.fn(),
  deleteRegistrationsByFilter: vi.fn(),
  bulkEraseAttendees: vi.fn(),
  fetchEventCustomFields: vi.fn(),
  fetchLegalDocuments: vi.fn(),
  goToLogin: vi.fn(),
};

export async function mockedClient() {
  const original = await vi.importActual<typeof import("../../src/api/client.js")>("../../src/api/client.js");
  return {
    ...original,
    fetchRegistrations: (...args: unknown[]) => api.fetchRegistrations(...args),
    fetchRegistrationCounts: (...args: unknown[]) => api.fetchRegistrationCounts(...args),
    fetchRegistration: (...args: unknown[]) => api.fetchRegistration(...args),
    acceptRegistrations: (...args: unknown[]) => api.acceptRegistrations(...args),
    rejectRegistrations: (...args: unknown[]) => api.rejectRegistrations(...args),
    retryRegistrationMails: (...args: unknown[]) => api.retryRegistrationMails(...args),
    deleteRegistrations: (...args: unknown[]) => api.deleteRegistrations(...args),
    deleteRegistrationsByFilter: (...args: unknown[]) => api.deleteRegistrationsByFilter(...args),
    bulkEraseAttendees: (...args: unknown[]) => api.bulkEraseAttendees(...args),
    fetchEventCustomFields: (...args: unknown[]) => api.fetchEventCustomFields(...args),
    fetchLegalDocuments: (...args: unknown[]) => api.fetchLegalDocuments(...args),
  };
}

export const loginNavigationModule = () => ({ goToLogin: (...args: unknown[]) => api.goToLogin(...args) });
// The other tabs read and edit their own things: their tests have them. The page is tested around the Requests tab.
export const fieldsTabModule = () => ({ RegistrationFieldsTab: () => <p>The attendee fields card</p> });
export const legalTabModule = () => ({ RegistrationLegalTab: () => <p>The legal texts of the event</p> });

/** Puts every handle back to what a page of requests needs to open: no request, nothing waiting, no questions and no texts. */
export function resetApi() {
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchRegistrations.mockResolvedValue(answer([]));
  api.fetchRegistrationCounts.mockResolvedValue(counts({}, "automatic"));
  api.fetchEventCustomFields.mockResolvedValue([]);
  api.fetchLegalDocuments.mockResolvedValue({ items: [], missing: [], limits: { title_chars: 200, content_chars: 100_000, consents: 10 } });
  api.fetchRegistration.mockImplementation(async (_event: string, id: string) => detail(id));
}

/** The name the server gives the requests a filter selects: the hash of their ids, as the server's own (so that a changed selection is a changed name). */
export function digestOf(ids: readonly string[]): string {
  return createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
}

export interface ServerOptions {
  mode?: RegistrationCountsDto["mode"];
  /** How many seats are free: an acceptance that needs more is refused with the numbers, as the server does. */
  freeSeats?: number | null;
}

/**
 * A small stand-in for the server of the requests, behind the mocked API: it lists, filters, pages and counts what it holds, and
 * an accept, reject, delete or send-again changes what it holds, so that what the screen reads again after an action is what the
 * action did. A test that needs the server to do something else (refuse, fail, answer late) overrides the one handle.
 */
export class FakeServer {
  rows: RegistrationListItemDto[];
  readonly options: Required<ServerOptions>;
  readonly attendees = new Map<string, string>();

  constructor(rows: RegistrationListItemDto[], options: ServerOptions = {}) {
    this.rows = rows;
    this.options = { mode: options.mode ?? "approval", freeSeats: options.freeSeats ?? null };
    this.install();
  }

  private install() {
    api.fetchRegistrations.mockImplementation((_event: string, params: RegistrationListParams) => Promise.resolve(this.page(params)));
    api.fetchRegistrationCounts.mockImplementation(() => Promise.resolve(this.counts()));
    api.acceptRegistrations.mockImplementation((_event: string, ids: string[]) => Promise.resolve(this.accept(ids)));
    api.rejectRegistrations.mockImplementation((_event: string, ids: string[]) => Promise.resolve(this.reject(ids)));
    api.retryRegistrationMails.mockImplementation((_event: string, ids: string[]) => Promise.resolve(this.retry(ids)));
    api.deleteRegistrations.mockImplementation((_event: string, ids: string[]) => Promise.resolve(this.remove(ids)));
    api.deleteRegistrationsByFilter.mockImplementation((_event: string, body: DeleteRegistrationsByFilterBody) => Promise.resolve(this.removeMatching(body)));
  }

  matching(params: Pick<RegistrationListParams, "status" | "q">): RegistrationListItemDto[] {
    return this.rows.filter((row) => (!params.status || row.status === params.status) && (!params.q || `${row.first_name} ${row.last_name} ${row.email}`.toLowerCase().includes(params.q.toLowerCase())));
  }

  page(params: RegistrationListParams): RegistrationListDto {
    const matching = this.matching(params);
    const start = (params.page - 1) * params.pageSize;
    const filtered = Boolean(params.status || params.olderThan || params.q);
    const digest = filtered && matching.length <= 500 ? digestOf(matching.map((row) => row.id)) : null;
    return answer(matching.slice(start, start + params.pageSize), matching.length, params.page, params.pageSize, { selection_digest: digest });
  }

  counts(): RegistrationCountsDto {
    const byStatus = { awaiting_email: 0, pending: 0, waitlist: 0, accepted: 0, rejected: 0 };
    for (const row of this.rows) byStatus[row.status] += 1;
    return counts(byStatus, this.options.mode);
  }

  private byId(id: string) {
    return this.rows.find((row) => row.id === id);
  }

  private setStatus(id: string, status: RegistrationListItemDto["status"]) {
    this.rows = this.rows.map((row) => (row.id === id ? { ...row, status } : row));
  }

  accept(ids: string[]): AcceptRegistrationsDto {
    const fits = ids.map((id) => this.byId(id)).filter((row): row is RegistrationListItemDto => row !== undefined && ["pending", "waitlist", "rejected"].includes(row.status));
    const needed = fits.reduce((sum, row) => sum + 1 + row.companions_count, 0);
    if (this.options.freeSeats !== null && needed > this.options.freeSeats) {
      throw new ApiError(409, "not_enough_seats", "not_enough_seats", undefined, undefined, undefined, { free: this.options.freeSeats, needed });
    }
    return {
      results: ids.map((id) => {
        const row = this.byId(id);
        if (!row) return { id, outcome: "gone" as const };
        if (row.status === "accepted") return { id, outcome: "already_decided" as const };
        if (!fits.includes(row)) return { id, outcome: "awaiting_email" as const };
        this.setStatus(id, "accepted");
        this.attendees.set(id, `at-${id}`);
        return { id, outcome: "accepted" as const, attendee_id: `at-${id}` };
      }),
    };
  }

  reject(ids: string[]): RejectRegistrationsDto {
    return {
      results: ids.map((id) => {
        const row = this.byId(id);
        if (!row) return { id, outcome: "gone" as const };
        if (row.status === "awaiting_email") return { id, outcome: "awaiting_email" as const };
        if (row.status === "accepted" || row.status === "rejected") return { id, outcome: "already_decided" as const };
        this.setStatus(id, "rejected");
        return { id, outcome: "rejected" as const };
      }),
    };
  }

  retry(ids: string[]): RetryRegistrationMailsDto {
    return {
      results: ids.map((id) => {
        const row = this.byId(id);
        if (!row) return { id, outcome: "gone" as const };
        if (!row.last_mail?.can_retry) return { id, outcome: "not_retryable" as const };
        this.rows = this.rows.map((other) => (other.id === id && other.last_mail ? { ...other, last_mail: { ...other.last_mail, status: "queued", retryable: null, can_retry: false } } : other));
        return { id, outcome: "retried" as const };
      }),
    };
  }

  /** Deletes what a filter selects, but only when it is still what the list showed: the same number, and the same requests, as the server does. */
  removeMatching(body: DeleteRegistrationsByFilterBody): DeleteRegistrationsDto {
    const matching = this.matching({ status: body.status, q: body.q });
    if (matching.length !== body.expected) throw new ApiError(409, "registration_count_changed", "registration_count_changed");
    if (digestOf(matching.map((row) => row.id)) !== body.selectionDigest) throw new ApiError(409, "registration_selection_changed", "registration_selection_changed");
    return this.remove(matching.map((row) => row.id));
  }

  remove(ids: string[]): DeleteRegistrationsDto {
    const results = ids.map((id) => {
      const row = this.byId(id);
      if (!row) return { id, outcome: "gone" as const };
      const attendee = this.attendees.get(id) ?? (row.status === "accepted" ? `at-${id}` : undefined);
      this.rows = this.rows.filter((other) => other.id !== id);
      return attendee ? { id, outcome: "deleted" as const, attendee_id: attendee } : { id, outcome: "deleted" as const };
    });
    const deleted = results.filter((result) => result.outcome === "deleted");
    return { results, deleted: deleted.length, attendees_erased: deleted.filter((result) => "attendee_id" in result).length, wallet_pending: 0 };
  }
}
