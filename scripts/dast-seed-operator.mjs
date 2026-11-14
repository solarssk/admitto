/**
 * Creates a synthetic org, event and event-scoped operator inside the DAST workflow's compose stack
 * (.github/workflows/dast-baseline.yml), so ZAP can scan /operator as a signed-in operator. The
 * stack has no CLI for this (only bootstrap-superadmin), and the app image contains the built
 * @admitto/db and @admitto/auth packages, so the workflow pipes this file into `node` in the app
 * container. Prints the event id as the last line of stdout.
 *
 * It also seeds an event whose guest registration form is open, at /r/dast-registration-event (guest registration, v0.8): the public
 * link as the way in, Cloudflare's published test keys as the bot protection, published legal texts and two questions. The workflow
 * scans /operator today; adding the form as a target is a one-line change there (the scan needs no sign-in).
 *
 * Only ever run against that disposable stack. Reads DAST_OPERATOR_EMAIL and
 * DAST_OPERATOR_PASSWORD from the environment.
 */
import { prisma } from "@admitto/db";
import { createUser } from "@admitto/auth";
import { SECRET_CONTEXTS, encryptToString } from "@admitto/crypto";

const email = process.env.DAST_OPERATOR_EMAIL;
const password = process.env.DAST_OPERATOR_PASSWORD;
if (!email || !password) {
  throw new Error(
    "DAST_OPERATOR_EMAIL and DAST_OPERATOR_PASSWORD are required",
  );
}

const org = await prisma.organization.create({
  data: { name: "DAST Org", slug: "dast-org" },
});
const event = await prisma.event.create({
  data: {
    title: "DAST Event",
    slug: "dast-event",
    date: new Date("2026-09-01T10:00:00Z"),
    organization_id: org.id,
  },
});
await prisma.attendee.create({
  data: {
    event_id: event.id,
    email: "dast.attendee@example.com",
    name: "Dast Attendee",
    status: "confirmed",
  },
});
const user = await createUser(prisma, {
  email,
  password,
  displayName: "DAST Operator",
});
await prisma.roleAssignment.create({
  data: {
    user_id: user.id,
    role: "operator",
    scope_type: "event",
    scope_id: event.id,
  },
});

const formEvent = await prisma.event.create({
  data: {
    title: "DAST Registration Event",
    slug: "dast-registration-event",
    date: new Date("2099-09-01T10:00:00Z"),
    organization_id: org.id,
    capacity: 300,
  },
});
await prisma.eventRegistrationSettings.create({
  data: { event_id: formEvent.id, mode: "automatic", access_methods: ["link"], verify_email: true, max_companions: 1, ask_company: true },
});
const published = new Date();
await prisma.legalDocument.createMany({
  data: [
    { event_id: formEvent.id, kind: "privacy_notice", title: "Privacy notice", content_html: "<p>Synthetic privacy notice.</p>", published_at: published },
    { event_id: formEvent.id, kind: "event_terms", title: "Event terms", content_html: "<p>Synthetic event terms.</p>", published_at: published },
  ],
});
await prisma.eventCustomField.createMany({
  data: [
    { event_id: formEvent.id, source_field: "diet", label: "Diet", type: "select", options: ["Vegan", "None"], show_on_form: true, display_order: 0 },
    { event_id: formEvent.id, source_field: "badge", label: "Badge name", type: "text", applies_to: "companion", show_on_form: true, display_order: 1 },
  ],
});
// Instance-wide settings, in the form the settings screens save them (the secret is encrypted with its own context).
const systemSettings = [
  { key: "registration_access_methods", value_json: JSON.stringify(["link"]) },
  {
    key: "registration_turnstile",
    value_json: JSON.stringify({
      siteKey: "1x00000000000000000000AA",
      secretEnc: encryptToString("1x0000000000000000000000000000000AA", SECRET_CONTEXTS.turnstileSecret),
    }),
  },
];
await prisma.systemSettings.createMany({ data: systemSettings });
await prisma.$disconnect();
console.log(event.id);
