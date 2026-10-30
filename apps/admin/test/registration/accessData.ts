import type {
  EventDto,
  LegalDocumentDto,
  LegalDocumentsListResponse,
  RegistrationReadinessCheckDto,
  RegistrationReadinessKey,
  RegistrationSettingsDto,
} from "../../src/api/types.js";
import { LEGAL_LIMITS, legalDoc } from "./legalFixtures.js";

export const event = { id: "evt-1", title: "Demo", slug: "demo", archived_at: null } as EventDto;
export const archivedEvent = { ...event, archived_at: "2026-10-01T10:00:00.000Z" } as EventDto;

/** The checks of an event that has chosen the link, in the order the server lists them. */
const LINK_KEYS: readonly RegistrationReadinessKey[] = [
  "access_method",
  "access_method_enabled",
  "bot_protection",
  "legal_documents",
  "form_questions",
  "required_fields",
  "mail_provider",
  "instance_url",
  "event_not_archived",
  "event_not_ended",
];

/** The checks of an event, all met but the ones named. */
export function checks(...missing: RegistrationReadinessKey[]): RegistrationReadinessCheckDto[] {
  return LINK_KEYS.map((key) => ({ key, ok: !missing.includes(key) }));
}

/** The settings of an event that is ready for registration to be turned on, with the link as its way in. */
export function settings(overrides: Partial<RegistrationSettingsDto> = {}): RegistrationSettingsDto {
  return {
    mode: null,
    access_methods: ["link"],
    waitlist_enabled: true,
    verify_email: true,
    max_companions: 0,
    ask_company: false,
    ask_department: false,
    consent_keys: [],
    styled_form_controls: false,
    password_set: false,
    guest_url: "https://admitto.example.com/r/demo",
    readiness: checks(),
    public_fields: [{ key: "parking", label: "Do you need a parking space?", type: "boolean", required: false }],
    ...overrides,
  };
}

/** The legal texts of the event as the list gives them: the two that are always needed, published, and the consents named. */
export function texts(...consents: Array<[key: string, title: string, published: boolean]>): LegalDocumentDto[] {
  return [
    legalDoc("privacy-notice", { published: true }),
    legalDoc("event-terms", { published: true }),
    ...consents.map(([key, title, published]) => legalDoc(`consent-${key}`, { title, published })),
  ];
}

export function legalAnswer(items: LegalDocumentDto[]): LegalDocumentsListResponse {
  return { items, missing: [], limits: LEGAL_LIMITS };
}
