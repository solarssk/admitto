import { JSDOM } from "jsdom";
import type { ClosedFormModel, FormQuestion, RegistrationFormModel } from "../../src/registration/form-model.js";

/** A form with every optional part switched on: both profile fields, one question of each kind (the four newer kinds are optional, so a form that is filled in "validly" needs no answer to them), an extra consent. */
export function formModel(overrides: Partial<RegistrationFormModel> = {}): RegistrationFormModel {
  return {
    event: {
      slug: "northwind-summit",
      title: "Northwind Partner Summit 2027",
      when: "14 May 2027, 09:00 - 17:00 CEST",
      venue: "Expo Centre, Warsaw",
      logoUrl: null,
      timezone: "Europe/Warsaw",
    },
    mode: "approval",
    verifyEmail: true,
    askCompany: true,
    askDepartment: true,
    questions: [
      question({ key: "day", label: "Which days will you attend?", type: "select", required: true, options: ["Both days", "Day 1 only"] }),
      question({ key: "parking", label: "I will arrive by car and need parking", type: "boolean" }),
      question({ key: "diet", label: "I have dietary requirements", type: "boolean", description: "Vegetarian, vegan or allergies." }),
      question({ key: "plate", label: "Car registration number", type: "text", description: "The venue uses it at the gate." }),
      question({ key: "badge", label: "Do you need a badge?", type: "boolean", required: true }),
      question({ key: "notes", label: "Anything else we should know?", type: "long_text", description: "The organisers read every answer." }),
      question({ key: "arrival_date", label: "Arrival date", type: "date" }),
      question({ key: "arrival_time", label: "Expected arrival", type: "datetime", description: "Roughly is fine." }),
      question({ key: "mobile", label: "Mobile phone", type: "phone", rules: { example: "+1 555 0100" } }),
    ],
    privacyPath: "/legal/northwind-summit/privacy-notice",
    termsPath: "/legal/northwind-summit/event-terms",
    consents: [{ key: "photos", title: "Photos in the newsletter", path: "/legal/northwind-summit/consent-photos" }],
    contact: { name: "Anna Kowalska", email: "events@northwind.example" },
    turnstileSiteKey: "1x00000000000000000000AA",
    ...overrides,
  };
}

export function question(overrides: Partial<FormQuestion> & Pick<FormQuestion, "key" | "label" | "type">): FormQuestion {
  return { description: null, required: false, options: [], rules: null, icon: null, showWhen: null, suggestions: [], ...overrides };
}

/**
 * A form with what the mockup shows: an icon on every kind of row and field, a panel under a Yes/No row and one under a
 * choice, a text box with suggestions, a row without an icon, and a question with no place for an icon. The ids of the
 * questions are f-q0 to f-q9 in this order.
 */
export function panelModel(overrides: Partial<RegistrationFormModel> = {}): RegistrationFormModel {
  return formModel({
    questions: [
      question({ key: "day", label: "Which days will you attend?", type: "select", required: true, options: ["Both days", "Day 1 only", "Day 2 only"] }),
      question({ key: "hotel", label: "Hotel name", type: "text", icon: "bed", showWhen: { field: "day", value: "Both days" } }),
      question({ key: "parking", label: "I will arrive by car and need parking", type: "boolean", icon: "parking" }),
      question({ key: "plate", label: "Car registration number", type: "text", icon: "car", description: "The venue uses it at the gate.", showWhen: { field: "parking", value: true } }),
      question({ key: "diet", label: "I have dietary requirements", type: "boolean", icon: "food", description: "Vegetarian, vegan or allergies." }),
      question({
        key: "diet_details",
        label: "What should we know?",
        type: "text",
        icon: "food",
        description: "Pick a suggestion, or write your own.",
        suggestions: ["No pork", "Vegetarian", "Vegan"],
        showWhen: { field: "diet", value: true },
      }),
      question({ key: "access", label: "I have accessibility or mobility needs", type: "boolean", icon: "accessible" }),
      question({ key: "shirt", label: "I would like a shirt", type: "boolean" }),
      question({ key: "notes", label: "Anything else?", type: "long_text", icon: "mail" }),
      question({ key: "arrival", label: "Arrival date", type: "date", icon: "calendar" }),
    ],
    ...overrides,
  });
}

/** One required question of each newer kind: what the page says when each is left empty or refused. */
export function requiredNewKinds(): FormQuestion[] {
  return [
    question({ key: "why", label: "Why would you like to attend?", type: "long_text", required: true, rules: { min_length: 20, max_length: 500 } }),
    question({ key: "checkin", label: "Hotel check-in date", type: "date", required: true }),
    question({ key: "flight", label: "Departure flight", type: "datetime", required: true }),
    question({ key: "extension", label: "Desk phone extension", type: "phone", required: true, rules: { digits_only: true, min_length: 3, max_length: 6, example: "1234" } }),
  ];
}

export function closedModel(overrides: Partial<ClosedFormModel> = {}): ClosedFormModel {
  return { event: formModel().event, contact: formModel().contact, ...overrides };
}

/** A node of a jsdom document. The web package builds without the DOM library, so the tests treat a node as loosely typed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Dom = any;

/** The document of `html`, with no script run and nothing fetched. */
export function documentOf(html: string) {
  return new JSDOM(html).window.document;
}
