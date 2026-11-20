import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { accessMethodDetail, actionLabel, botProtectionOffText, checklistBanner, checklistFromSettings, formQuestionsText, openStepCount, READINESS_COPY, readinessCopy, remedyFor, splitChecklist } from "../../src/registration/accessReadiness.js";

/** The checks the server reports, read from the file that holds them: the screen has words for each one, and for no other. */
function serverKeys(): string[] {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../web/src/registration/readiness.ts"), "utf8");
  const list = /READINESS_KEYS = \[([^\]]*)\] as const/.exec(source)?.[1] ?? "";
  return [...list.matchAll(/"([a-z_]+)"/g)].map((match) => match[1] ?? "");
}

describe("the words of the checks", () => {
  it("are there for every check the server reports, in its order, and for no other", () => {
    const keys = serverKeys();

    expect(keys).toHaveLength(12);
    expect(Object.keys(READINESS_COPY)).toEqual(keys);
  });

  it("mark the row for bot protection that is not used as information, and no other row", () => {
    const info = Object.entries(READINESS_COPY).filter(([, copy]) => copy.info === true);

    expect(info.map(([key]) => key)).toEqual(["bot_protection_not_used"]);
    expect(READINESS_COPY.bot_protection_not_used.met).toBe("Off. The link and password forms have no bot check.");
    // The row names who turned it off, from the switch of the organisation.
    expect(botProtectionOffText("not_used")).toBe("Off for this organisation. The link and password forms have no bot check.");
    expect(botProtectionOffText("required")).toBe("Off for this event. The link and password forms of this event have no bot check.");
    expect(READINESS_COPY.bot_protection_not_used.remedy).toBeUndefined();
  });

  it("give every check a title, a sentence for when it is met and another for when it is not", () => {
    for (const [key, copy] of Object.entries(READINESS_COPY)) {
      expect(copy.title, key).not.toBe("");
      expect(copy.met, key).not.toBe("");
      expect(copy.missing, key).not.toBe("");
      expect(copy.met, key).not.toBe(copy.missing);
    }
  });

  it("send what a superadmin sets up to the superadmin, and what the organiser can put right to where they do it", () => {
    const remedy = (key: keyof typeof READINESS_COPY) => READINESS_COPY[key].remedy;

    for (const key of ["bot_protection", "mail_provider", "instance_url"] as const) {
      expect(remedy(key), key).toEqual({ text: "Ask a superadmin to set it up." });
    }
    // A superadmin is sent to the organisation's settings for each of them.
    expect(remedyFor(READINESS_COPY.bot_protection, true)).toEqual({ text: "Set it up in Organisation settings, External services.", link: "organisation_external" });
    expect(remedyFor(READINESS_COPY.mail_provider, true)).toEqual({ text: "Set it up in Organisation settings, Mail.", link: "organisation_mail" });
    expect(remedyFor(READINESS_COPY.instance_url, true)).toEqual({ text: "Set it in Organisation settings, General.", link: "organisation_general" });
    // How guests open the form is set in Event settings, by a superadmin: the others are told to ask, a superadmin is sent there.
    for (const key of ["access_method", "identity_provider", "password"] as const) {
      expect(remedy(key)?.text, key).toMatch(/^Ask a superadmin to (choose|set) it in Event settings, Registration\.$/);
      expect(remedyFor(READINESS_COPY[key], true)?.link, key).toBe("registration_settings");
      expect(remedyFor(READINESS_COPY[key], true)?.text, key).toMatch(/^(Choose|Set) it in Event settings, Registration\.$/);
      expect(remedyFor(READINESS_COPY[key], false), key).toBe(READINESS_COPY[key].remedy);
    }
    // A check that a superadmin has no other place for reads the same for everybody.
    expect(remedyFor(READINESS_COPY.legal_documents, true)).toBe(READINESS_COPY.legal_documents.remedy);
    expect(remedy("legal_documents")?.link).toBe("legal");
    expect(remedy("form_questions")?.link).toBe("fields");
    expect(remedy("required_fields")?.link).toBe("fields");
    expect(remedy("event_not_ended")?.link).toBe("event_settings");
  });

  it("are plain: no dash that stands for a pause, no code and no name of a service", () => {
    const words = Object.values(READINESS_COPY)
      .flatMap((copy) => [copy.title, copy.met, copy.missing, copy.remedy?.text ?? "", copy.superadminRemedy?.text ?? ""])
      .join("\n");

    expect(words).not.toMatch(/[\u2013\u2014]/);
    expect(words).not.toMatch(/turnstile|cloudflare|smtp|_/i);
  });

  it("name the row about the access method, and never call it a way in", () => {
    expect(READINESS_COPY.access_method.title).toBe("Access method");
    expect(JSON.stringify(READINESS_COPY.access_method)).not.toMatch(/way in/i);
    expect(Object.keys(READINESS_COPY)).not.toContain("access_method_enabled");
  });

  it("say the three access methods, and that the identity provider is chosen and turned on", () => {
    expect(READINESS_COPY.access_method).toMatchObject({ met: "An access method is chosen.", missing: "No access method is chosen yet. Guests cannot open the form." });
    expect(READINESS_COPY.identity_provider).toMatchObject({
      title: "Identity provider",
      met: "An identity provider is chosen and turned on.",
      missing: "Choose an identity provider for Company SSO. If the list is empty, ask a superadmin to set one up under Identity.",
    });
  });

  it("read a check that the screen does not know yet, so a newer server never leaves a blank row", () => {
    const copy = readinessCopy("something_new");

    expect(copy.title).toBe("Other");
    expect(copy.missing).toBe("Something else that registration needs is missing.");
    expect(readinessCopy("bot_protection")).toBe(READINESS_COPY.bot_protection);
  });
});

describe("accessMethodDetail: what the row Access method says is set", () => {
  const entra = { display_name: "Contoso Entra", state: "ready" };

  it.each([
    ["the link", "link", null, "Link. Anyone who has the link can ask to join."],
    ["the password", "password", null, "Password. Guests need the link and the event password to open the form."],
    ["Company SSO with its provider", "sso", entra, "Company SSO. Guests sign in with Contoso Entra."],
    ["Company SSO with a provider that is turned off", "sso", { ...entra, state: "disabled" }, "Company SSO. Guests sign in with Contoso Entra (turned off)."],
    ["Company SSO with no provider chosen", "sso", null, "Company SSO. No identity provider is chosen yet."],
    ["Company SSO with a provider that has no name any more", "sso", { display_name: null, state: "missing" }, "Company SSO. No identity provider is chosen yet."],
    ["no method", null, null, "No access method is chosen yet. Guests cannot open the form."],
  ] as const)("says it for %s", (_what, method, provider, expected) => {
    expect(accessMethodDetail(method, provider)).toBe(expected);
  });
});

describe("splitChecklist: who does each open step", () => {
  const check = (key: string, ok: boolean) => ({ key, ok });
  const all = [
    check("access_method", true),
    check("bot_protection", false),
    check("legal_documents", false),
    check("mail_provider", false),
    check("form_questions", true),
    check("event_not_archived", false),
    check("bot_protection_not_used", true),
  ];
  const keys = (list: Array<{ key: string }>) => list.map((entry) => entry.key);

  it("marks the checks that only a superadmin can put right", () => {
    const only = Object.entries(READINESS_COPY).filter(([, copy]) => copy.superadminOnly === true).map(([key]) => key);

    expect(only).toEqual(["access_method", "bot_protection", "identity_provider", "password", "mail_provider", "instance_url", "event_not_archived"]);
  });

  it("leaves a step that the person can do under For you, and one that waits for a superadmin under Waiting, for somebody who is not one", () => {
    const sections = splitChecklist(all, false);

    expect(keys(sections.forYou)).toEqual(["legal_documents"]);
    expect(keys(sections.waiting)).toEqual(["bot_protection", "mail_provider"]);
    // What is met comes first, then the information row; the archived row is never listed.
    expect(keys(sections.done)).toEqual(["access_method", "form_questions", "bot_protection_not_used"]);
    expect(sections.total).toBe(5);
  });

  it("gives a superadmin every open step, and nothing to wait for", () => {
    const sections = splitChecklist(all, true);

    expect(keys(sections.forYou)).toEqual(["bot_protection", "legal_documents", "mail_provider"]);
    expect(sections.waiting).toEqual([]);
  });

  it("counts the open steps the same for everybody, without information and the archived row", () => {
    expect(openStepCount(all)).toBe(3);
    expect(openStepCount([])).toBe(0);
    expect(openStepCount([check("bot_protection_not_used", false), check("event_not_archived", false)])).toBe(0);
  });

  it("keeps a check it has no words for under For you, so a newer server never hides a step", () => {
    expect(keys(splitChecklist([check("something_new", false)], false).forYou)).toEqual(["something_new"]);
  });
});

describe("formQuestionsText", () => {
  it("says how many questions of the organiser are on the form, in the singular and the plural, and what a guest gives when there are none", () => {
    expect(formQuestionsText(1)).toBe("1 question of yours is on the form.");
    expect(formQuestionsText(3)).toBe("3 questions of yours are on the form.");
    expect(formQuestionsText(0)).toContain("No question of yours is on the form.");
  });
});

describe("checklistFromSettings: the checks of the checklist", () => {
  const readiness = [{ key: "access_method", ok: true }];
  const address = { domain: "events.example.com", status: "ok", check_result: "ok", verified: true, checked_at: null } as const;

  it("adds the address for guests only when a check once found it working, open while the last check fails", () => {
    expect(checklistFromSettings({ readiness, own_address: null })).toEqual(readiness);
    expect(checklistFromSettings({ readiness, own_address: { ...address, verified: false, status: "failing" } })).toEqual(readiness);
    expect(checklistFromSettings({ readiness, own_address: address })).toEqual([...readiness, { key: "own_address", ok: true }]);
    expect(checklistFromSettings({ readiness, own_address: { ...address, status: "failing" } })).toEqual([...readiness, { key: "own_address", ok: false }]);
  });

  it("has words and a superadmin's remedy for the address, and the server's list of keys does not hold it", () => {
    expect(readinessCopy("own_address")).toMatchObject({ title: "Address for guests", superadminOnly: true });
    expect(remedyFor(readinessCopy("own_address"), true)).toEqual({ text: "Check the address in Event settings, Registration.", link: "registration_settings" });
    expect(Object.keys(READINESS_COPY)).not.toContain("own_address");
  });
});

describe("actionLabel", () => {
  it.each([
    ["legal", "Open Legal"],
    ["fields", "Open Fields"],
    ["event_settings", "Open Event settings"],
    ["registration_settings", "Open Event settings"],
    ["organisation_general", "Open Organisation settings"],
    ["organisation_mail", "Open Organisation settings"],
    ["organisation_external", "Open Organisation settings"],
  ] as const)("is the button of %s", (link, label) => {
    expect(actionLabel(link)).toBe(label);
  });
});

describe("checklistBanner", () => {
  const base = { mode: null, archived: false, forYou: 0, waiting: 0, addressStopped: false } as const;

  it("is about the archive first, whatever is open", () => {
    expect(checklistBanner({ ...base, archived: true, forYou: 2 })).toMatchObject({ variant: "info", action: null });
  });

  it("is ready, with the button to turn registration on, when registration is off and nothing is open, and open, with the button to turn it off, when it is on", () => {
    expect(checklistBanner(base)).toEqual({ variant: "success", text: "Ready. Registration can be turned on.", action: "turn_on" });
    expect(checklistBanner({ ...base, mode: "automatic" })).toEqual({ variant: "success", text: "Registration is open.", action: "turn_off" });
  });

  it("is an error while registration is on and a step is open, and names the address when that is the step", () => {
    expect(checklistBanner({ ...base, mode: "approval", forYou: 1 }).text).toContain("something it needs is missing");
    expect(checklistBanner({ ...base, mode: "approval", waiting: 1, addressStopped: true }).text).toContain("the address of this event stopped working");
  });
});
