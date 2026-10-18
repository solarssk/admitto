import type { PrismaClient } from "@admitto/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALLOWED_PLACEHOLDERS,
  DEFAULT_BODY_MJML,
  DEFAULT_SAMPLE_VARS,
  DEFAULT_TEMPLATE_NAME,
  SYSTEM_TEMPLATE_FORBIDDEN_PLACEHOLDERS,
  SYSTEM_TEMPLATE_NAMES,
  UnknownBuiltinTemplateError,
  UnknownPlaceholdersError,
  URL_PLACEHOLDERS,
  REQUIRED_URL_PLACEHOLDERS,
  defaultTemplateLabel,
  disallowedPlaceholdersForTemplate,
  extractPlaceholderTokens,
  getBuiltinTemplate,
  getBuiltinTemplateSource,
  isReservedTemplateName,
  isSystemTemplateName,
  renderTemplate,
  resolveEventContactVars,
  resolveTemplateForEvent,
  setMailTemplate,
  validateTemplate,
} from "../src/index.js";

const EVENT = { id: "evt-1", organization_id: "org-1" };

function fakePrisma(rows: Record<string, { name: string }> = {}) {
  const findUnique = vi.fn(
    async ({ where }: { where: { scope_type_scope_id_name: { scope_type: string; name: string } } }) => {
      const key = where.scope_type_scope_id_name;
      const row = rows[`${key.scope_type}:${key.name}`];
      return row
        ? {
            id: `id-${key.scope_type}-${key.name}`,
            label: `Label ${key.name}`,
            subject_template: "S",
            compiled_html_template: "<p>C</p>",
            template_format: "html",
          }
        : null;
    },
  );
  return { prisma: { mailTemplate: { findUnique } } as unknown as PrismaClient, findUnique };
}

describe("system template names", () => {
  it("are the four registration mails, and ticket is not one of them", () => {
    expect([...SYSTEM_TEMPLATE_NAMES]).toEqual([
      "registration-confirm",
      "registration-received",
      "registration-waitlist",
      "registration-rejected",
    ]);
    expect(isSystemTemplateName("registration-received")).toBe(true);
    expect(isSystemTemplateName(DEFAULT_TEMPLATE_NAME)).toBe(false);
    expect(isSystemTemplateName("reminder")).toBe(false);
    expect(isSystemTemplateName("constructor")).toBe(false);
    expect(isSystemTemplateName("__proto__")).toBe(false);
  });

  it("reserve ticket and every system name against a free template", () => {
    expect(isReservedTemplateName("ticket")).toBe(true);
    for (const name of SYSTEM_TEMPLATE_NAMES) expect(isReservedTemplateName(name)).toBe(true);
    expect(isReservedTemplateName("registration_received")).toBe(false);
  });

  it("forbid the ticket, QR and wallet placeholders for system names only", () => {
    expect([...SYSTEM_TEMPLATE_FORBIDDEN_PLACEHOLDERS].sort()).toEqual([
      "apple_wallet_url",
      "download_page_url",
      "google_wallet_url",
      "qr_image_url",
      "ticket_url",
    ]);
    expect(disallowedPlaceholdersForTemplate("registration-waitlist")).toBe(SYSTEM_TEMPLATE_FORBIDDEN_PLACEHOLDERS);
    expect(disallowedPlaceholdersForTemplate("ticket")).toBeUndefined();
    expect(disallowedPlaceholdersForTemplate("reminder")).toBeUndefined();
  });
});

describe("new placeholders", () => {
  it("are whitelisted, and only confirm_url is a (non-required) URL placeholder", () => {
    for (const name of ["confirm_url", "contact_name", "contact_email"]) {
      expect(ALLOWED_PLACEHOLDERS.has(name)).toBe(true);
    }
    expect(URL_PLACEHOLDERS.has("confirm_url")).toBe(true);
    expect(URL_PLACEHOLDERS.has("contact_email")).toBe(false);
    expect(REQUIRED_URL_PLACEHOLDERS.has("confirm_url")).toBe(false);
  });

  it("render with the sample vars", async () => {
    const template = await getBuiltinTemplate("registration-confirm");
    const out = renderTemplate(
      { subject: template.subjectTemplate, compiledHtml: template.compiledHtmlTemplate },
      DEFAULT_SAMPLE_VARS,
    );
    expect(out.html).toContain("https://tickets.example.com/r/sample-event/confirm/");
    expect(out.html).toContain("organizer@example.com");
  });
});

describe("built-in registry", () => {
  it("serves ticket by default, unchanged", async () => {
    const byDefault = await getBuiltinTemplate();
    expect(byDefault).toBe(await getBuiltinTemplate("ticket"));
    expect(getBuiltinTemplateSource("ticket").body).toBe(DEFAULT_BODY_MJML);
    expect(byDefault.compiledHtmlTemplate).toContain("{{ticket_url}}");
  });

  it("throws on a name it does not know, instead of falling back to the ticket mail", async () => {
    await expect(getBuiltinTemplate("nope")).rejects.toBeInstanceOf(UnknownBuiltinTemplateError);
    await expect(getBuiltinTemplate("constructor")).rejects.toBeInstanceOf(UnknownBuiltinTemplateError);
    expect(() => getBuiltinTemplateSource("__proto__")).toThrow(UnknownBuiltinTemplateError);
  });

  it.each([...SYSTEM_TEMPLATE_NAMES])("%s compiles, is valid and carries no ticket or wallet link", async (name) => {
    const source = getBuiltinTemplateSource(name);
    const forbidden = SYSTEM_TEMPLATE_FORBIDDEN_PLACEHOLDERS;
    expect(validateTemplate({ subject: source.subject, body: source.body }, undefined, forbidden)).toEqual([]);
    const tokens = [...extractPlaceholderTokens(source.subject), ...extractPlaceholderTokens(source.body)];
    expect(tokens.filter((t) => forbidden.has(t))).toEqual([]);
    expect(tokens).toEqual(expect.arrayContaining(["event_name", "first_name", "contact_name", "contact_email"]));

    const compiled = await getBuiltinTemplate(name);
    expect(compiled.source).toBe("builtin");
    expect(compiled.templateFormat).toBe("mjml");
    expect(compiled.compiledHtmlTemplate.toLowerCase()).toContain("<table");
    expect(defaultTemplateLabel(name)).toBe(source.label);
    const rendered = renderTemplate(
      { subject: compiled.subjectTemplate, compiledHtml: compiled.compiledHtmlTemplate },
      DEFAULT_SAMPLE_VARS,
    );
    expect(rendered.html).not.toMatch(/\{\{/);
  });

  it("puts the confirm button only in registration-confirm", () => {
    expect(getBuiltinTemplateSource("registration-confirm").body).toContain('href="{{confirm_url}}"');
    for (const name of SYSTEM_TEMPLATE_NAMES.filter((n) => n !== "registration-confirm")) {
      expect(getBuiltinTemplateSource(name).body).not.toContain("{{confirm_url}}");
    }
  });

  it("labels an unknown name by itself", () => {
    expect(defaultTemplateLabel("reminder")).toBe("reminder");
    expect(defaultTemplateLabel("ticket")).toBe("Ticket email");
  });
});

describe("resolveTemplateForEvent by name", () => {
  it("asks for ticket when no name is given (existing callers unchanged)", async () => {
    const { prisma, findUnique } = fakePrisma();
    const resolved = await resolveTemplateForEvent(EVENT, prisma);
    expect(resolved.source).toBe("builtin");
    expect(resolved.compiledHtmlTemplate).toContain("{{ticket_url}}");
    const names = findUnique.mock.calls.map(([arg]) => arg.where.scope_type_scope_id_name.name);
    expect(names).toEqual(["ticket", "ticket"]);
  });

  it("resolves a named template event row, then organization row, then built-in", async () => {
    const name = "registration-received";
    const a = fakePrisma({ [`event:${name}`]: { name }, [`organization:${name}`]: { name } });
    expect((await resolveTemplateForEvent(EVENT, a.prisma, name)).source).toBe("event");

    const b = fakePrisma({ [`organization:${name}`]: { name } });
    expect((await resolveTemplateForEvent(EVENT, b.prisma, name)).source).toBe("organization");

    const c = fakePrisma({ "event:ticket": { name: "ticket" } });
    const builtin = await resolveTemplateForEvent(EVENT, c.prisma, name);
    expect(builtin.source).toBe("builtin");
    expect(builtin.subjectTemplate).toBe(getBuiltinTemplateSource(name).subject);
  });

  it("throws for an unknown name with no row", async () => {
    const { prisma } = fakePrisma();
    await expect(resolveTemplateForEvent(EVENT, prisma, "nope")).rejects.toBeInstanceOf(
      UnknownBuiltinTemplateError,
    );
  });
});

describe("setMailTemplate on a system name", () => {
  const upsert = vi.fn(async () => undefined);
  const prisma = { mailTemplate: { upsert } } as unknown as PrismaClient;
  const scope = { scopeType: "organization", scopeId: "org-1", name: "registration-received" } as const;

  beforeEach(() => upsert.mockClear());

  it("refuses {{ticket_url}}", async () => {
    await expect(
      setMailTemplate(scope, { subject: "S", body: '<a href="{{ticket_url}}">x</a>', format: "html" }, prisma),
    ).rejects.toBeInstanceOf(UnknownPlaceholdersError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("accepts confirm_url and gives a new row its built-in label", async () => {
    await setMailTemplate(scope, { subject: "S", body: '<a href="{{confirm_url}}">x</a>', format: "html" }, prisma);
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0] as unknown as [{ create: { label: string } }];
    expect(arg[0].create.label).toBe("Registration: received");
  });

  it("still lets the ticket name use ticket_url", async () => {
    await setMailTemplate(
      { ...scope, name: "ticket" },
      { subject: "S", body: '<a href="{{ticket_url}}">x</a>', format: "html" },
      prisma,
    );
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});

describe("resolveEventContactVars", () => {
  function contactPrisma(contact: unknown, org: unknown) {
    const findFirst = vi.fn(async () => contact);
    const findUnique = vi.fn(async () => ({ organization: org }));
    return {
      prisma: { eventContact: { findFirst }, event: { findUnique } } as unknown as PrismaClient,
      findFirst,
    };
  }

  it("takes the first event contact with an e-mail, in sort order", async () => {
    const { prisma, findFirst } = contactPrisma({ name: "Ann", email: "ann@example.com" }, null);
    expect(await resolveEventContactVars("evt-1", prisma)).toEqual({
      contact_name: "Ann",
      contact_email: "ann@example.com",
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ event_id: "evt-1", email: { not: null } }),
        orderBy: [{ sort_order: "asc" }, { created_at: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("falls back to the organization support contact, named or by organization name", async () => {
    const named = contactPrisma(null, { name: "Org", support_contact_name: "Help", support_contact_email: "h@example.com" });
    expect(await resolveEventContactVars("evt-1", named.prisma)).toEqual({
      contact_name: "Help",
      contact_email: "h@example.com",
    });
    const unnamed = contactPrisma(null, { name: "Org", support_contact_name: null, support_contact_email: "h@example.com" });
    expect(await resolveEventContactVars("evt-1", unnamed.prisma)).toEqual({
      contact_name: "Org",
      contact_email: "h@example.com",
    });
  });

  it("is empty when neither exists", async () => {
    const none = contactPrisma(null, { name: "Org", support_contact_name: null, support_contact_email: null });
    expect(await resolveEventContactVars("evt-1", none.prisma)).toEqual({ contact_name: "", contact_email: "" });
  });
});
