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

/** The identity providers a superadmin has turned on: two, so that none is taken for the event by itself. */
export const PROVIDERS: RegistrationSettingsDto["sso_providers"] = [
  { id: "idp-entra", display_name: "Contoso Entra", kind: "entra" },
  { id: "idp-google", display_name: "Contoso Google", kind: "google" },
];

/** The settings of an event whose way in is the company SSO with the first of the providers chosen, and ready to be used. */
export function ssoEventSettings(overrides: Partial<RegistrationSettingsDto> = {}): RegistrationSettingsDto {
  return settings({
    access_methods: ["sso"],
    sso_provider_id: "idp-entra",
    sso_provider: { id: "idp-entra", state: "ready", display_name: "Contoso Entra", kind: "entra" },
    readiness: ssoChecks(),
    ...overrides,
  });
}

/** The checks of an event that has chosen the link, in the order the server lists them. */
const LINK_KEYS: readonly RegistrationReadinessKey[] = [
  "access_method",
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
    bot_protection: "required",
    waitlist_enabled: true,
    verify_email: true,
    max_companions: 0,
    ask_company: false,
    ask_department: false,
    consent_keys: [],
    styled_form_controls: false,
    bot_protection_enabled: true,
    sso_claim_name: null,
    sso_claim_values: [],
    sso_provider_id: null,
    sso_provider: null,
    sso_providers: PROVIDERS,
    password_set: false,
    guest_url: "https://admitto.example.com/r/demo",
    instance_host: "admitto.example.com",
    own_address: null,
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

/** The checks of an event that has chosen the company SSO: no bot protection among them, and the identity provider instead. */
export function ssoChecks(...missing: RegistrationReadinessKey[]): RegistrationReadinessCheckDto[] {
  return LINK_KEYS.map((key) => (key === "bot_protection" ? "identity_provider" : key)).map((key) => ({ key, ok: !missing.includes(key) }));
}

/** The checks of an event while the superadmin set bot protection to "not used": the information row in the place of the bot check. */
export function notUsedChecks(...missing: RegistrationReadinessKey[]): RegistrationReadinessCheckDto[] {
  return LINK_KEYS.map((key) => (key === "bot_protection" ? "bot_protection_not_used" : key)).map((key) => ({ key, ok: !missing.includes(key) }));
}
