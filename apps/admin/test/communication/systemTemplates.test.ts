import { describe, expect, it } from "vitest";
import { SYSTEM_TEMPLATE_NAMES } from "@admitto/mail-templates/systemTemplates";
import type { MailTemplateListItem } from "../../src/api/types.js";
import {
  SYSTEM_TEMPLATE_COMMON_NOTE,
  VIRTUAL_TICKET_KEY,
  activeSystemName,
  isVirtualKey,
  systemPickerOptions,
  systemTemplateDescription,
  systemTemplateIcon,
  virtualSystemKey,
  virtualSystemName,
} from "../../src/communication/systemTemplates.js";

function row(id: string, name: string): MailTemplateListItem {
  return {
    id,
    name,
    label: name,
    icon: null,
    description: null,
    template_format: "html",
    subject_template: "S",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("the key of a registration mail that has no row", () => {
  it("round-trips for every system name, and is not an id", () => {
    for (const name of SYSTEM_TEMPLATE_NAMES) {
      const key = virtualSystemKey(name);
      expect(key).toBe(`virtual-${name}`);
      expect(virtualSystemName(key)).toBe(name);
      expect(isVirtualKey(key)).toBe(true);
    }
  });

  it("is told apart from the ticket's key, a row's id and anything that only looks like one", () => {
    expect(virtualSystemName(VIRTUAL_TICKET_KEY)).toBeNull();
    expect(isVirtualKey(VIRTUAL_TICKET_KEY)).toBe(true);
    for (const key of ["", "virtual-", "virtual-reminder", "virtual-constructor", "virtual-__proto__", "registration-confirm", "tpl-1"]) {
      expect(virtualSystemName(key), key).toBeNull();
      expect(isVirtualKey(key), key).toBe(false);
    }
  });
});

describe("activeSystemName", () => {
  const templates = [row("tpl-confirm", "registration-confirm"), row("tpl-rem", "reminder"), row("tpl-ticket", "ticket")];

  it("names the mail behind a virtual key and behind the id of its saved row", () => {
    expect(activeSystemName(virtualSystemKey("registration-waitlist"), templates)).toBe("registration-waitlist");
    expect(activeSystemName("tpl-confirm", templates)).toBe("registration-confirm");
  });

  it("is null for the ticket template and the operator's own templates, saved or not", () => {
    expect(activeSystemName(VIRTUAL_TICKET_KEY, templates)).toBeNull();
    expect(activeSystemName("tpl-ticket", templates)).toBeNull();
    expect(activeSystemName("tpl-rem", templates)).toBeNull();
    expect(activeSystemName("tpl-unknown", templates)).toBeNull();
  });
});

describe("systemPickerOptions", () => {
  it("lists the four mails in the order a guest meets them, each with its own icon and the product's label", () => {
    expect(systemPickerOptions([])).toEqual([
      { id: "virtual-registration-confirm", label: "Registration: confirm email", icon: "mail-check" },
      { id: "virtual-registration-received", label: "Registration: received", icon: "mail-opened" },
      { id: "virtual-registration-waitlist", label: "Registration: waiting list", icon: "hourglass" },
      { id: "virtual-registration-rejected", label: "Registration: declined", icon: "user-x" },
    ]);
  });

  it("puts the id of a saved row in the place of its virtual key, and keeps the product's label and icon over the stored ones", () => {
    const saved = { ...row("tpl-waitlist", "registration-waitlist"), label: "Renamed", icon: "star" };
    const options = systemPickerOptions([saved, row("tpl-rem", "reminder")]);
    expect(options.map((o) => o.id)).toEqual([
      "virtual-registration-confirm",
      "virtual-registration-received",
      "tpl-waitlist",
      "virtual-registration-rejected",
    ]);
    expect(options[2]).toEqual({ id: "tpl-waitlist", label: "Registration: waiting list", icon: "hourglass" });
  });
});

describe("what the editor says about each mail", () => {
  it("says the guest's name stays empty in the three mails that can reach an address nobody has confirmed, and not in the declined one", () => {
    for (const name of ["registration-confirm", "registration-received", "registration-waitlist"] as const) {
      expect(systemTemplateDescription(name), name).toContain("name stays empty");
    }
    // Staff have decided about the registration by then, so the name is there (mayShowNames in mail-delivery).
    expect(systemTemplateDescription("registration-rejected")).not.toContain("name stays empty");
  });

  it("has a different icon and a different description for each, written without an em dash", () => {
    const icons = SYSTEM_TEMPLATE_NAMES.map((name) => systemTemplateIcon(name));
    expect(new Set(icons).size).toBe(SYSTEM_TEMPLATE_NAMES.length);
    const descriptions = SYSTEM_TEMPLATE_NAMES.map((name) => systemTemplateDescription(name));
    expect(new Set(descriptions).size).toBe(SYSTEM_TEMPLATE_NAMES.length);
    for (const text of [...descriptions, SYSTEM_TEMPLATE_COMMON_NOTE]) {
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toContain("\u2014");
    }
  });
});
