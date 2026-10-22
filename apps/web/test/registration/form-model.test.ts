import type { PrismaClient } from "@admitto/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRegistrationPage } from "../../src/registration/form-model.js";
import { resolveAccessMethodAvailability } from "../../src/registration/access-methods.js";
import { resolveTurnstileKeys } from "../../src/registration/turnstile-settings.js";

vi.mock("../../src/registration/access-methods.js", () => ({ resolveAccessMethodAvailability: vi.fn() }));
vi.mock("../../src/registration/turnstile-settings.js", () => ({ resolveTurnstileKeys: vi.fn() }));
vi.mock("../../src/legal/registration-gate.js", () => ({
  loadRequiredLegalDocuments: vi.fn(async () => ({
    published: [
      { kind: "privacy_notice", key: "", title: "Privacy notice" },
      { kind: "event_terms", key: "", title: "Event terms" },
    ],
    missing: [],
  })),
}));
vi.mock("@admitto/mail-templates", () => ({
  resolveEventContactVars: vi.fn(async () => ({ contact_name: "", contact_email: "", contact_line: "" })),
}));
vi.mock("@admitto/tickets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@admitto/tickets")>()),
  loadRegistrantFormFields: vi.fn(async () => []),
}));

const row = {
  id: "evt-1",
  slug: "northwind-summit",
  title: "Northwind",
  date: new Date("2099-05-14T12:00:00Z"),
  timezone: "Europe/Warsaw",
  event_hours_start: null,
  event_hours_end: null,
  archived_at: null,
  logo_url: null,
  header_image_url: null,
  organization: { logo_url: null, header_image_url: null },
  location_details: null,
  registration_settings: {
    mode: "approval",
    access_methods: ["link"],
    verify_email: true,
    ask_company: false,
    ask_department: false,
    consent_keys: [],
  },
};

const db = { event: { findUnique: vi.fn(async () => row) } } as unknown as PrismaClient;
const NOW = new Date("2026-10-21T12:00:00Z");

const availability = (available: boolean) => [
  { method: "link" as const, enabled: true, available, blockedBy: null },
  { method: "password" as const, enabled: false, available: false, blockedBy: null },
  { method: "sso" as const, enabled: false, available: false, blockedBy: null },
];

beforeEach(() => {
  vi.mocked(resolveAccessMethodAvailability).mockResolvedValue(availability(true));
  vi.mocked(resolveTurnstileKeys).mockResolvedValue({ state: "ready", siteKey: "site-key", secret: "secret" });
});

describe("loadRegistrationPage, when the answers of its dependencies do not agree", () => {
  it("opens for an event whose link is available and whose keys are ready", async () => {
    const state = await loadRegistrationPage(db, "northwind-summit", NOW);
    expect(state.kind).toBe("open");
    if (state.kind === "open") expect(state.form.turnstileSiteKey).toBe("site-key");
  });

  it("does not open when the link was available a moment ago but the keys are not ready now", async () => {
    vi.mocked(resolveTurnstileKeys).mockResolvedValue({ state: "incomplete" });
    expect(await loadRegistrationPage(db, "northwind-summit", NOW)).toEqual({ kind: "not_found" });
    vi.mocked(resolveTurnstileKeys).mockResolvedValue({ state: "unreadable" });
    expect(await loadRegistrationPage(db, "northwind-summit", NOW)).toEqual({ kind: "not_found" });
  });

  it("does not open when the link is not available", async () => {
    vi.mocked(resolveAccessMethodAvailability).mockResolvedValue(availability(false));
    expect(await loadRegistrationPage(db, "northwind-summit", NOW)).toEqual({ kind: "not_found" });
  });

  it("is closed, with no contact, once the event is over, whatever the keys say", async () => {
    vi.mocked(resolveTurnstileKeys).mockResolvedValue({ state: "incomplete" });
    const over = new Date("2099-05-15T12:00:00Z");
    const state = await loadRegistrationPage(db, "northwind-summit", over);
    expect(state.kind).toBe("closed");
    if (state.kind === "closed") expect(state.page.contact).toBeNull();
  });

  it("does not look anything else up for a slug that cannot be an event's", async () => {
    const findUnique = vi.mocked(db.event.findUnique);
    findUnique.mockClear();
    expect(await loadRegistrationPage(db, "Bad Slug", NOW)).toEqual({ kind: "not_found" });
    expect(findUnique).not.toHaveBeenCalled();
    expect(resolveAccessMethodAvailability).not.toHaveBeenCalled();
  });
});
