import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { accessMethodDetail, botProtectionOffText, READINESS_COPY, readinessCopy, remedyFor } from "../../src/registration/accessReadiness.js";

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
    // How guests open the form is set in Event settings, by a superadmin: the others are told to ask, a superadmin is sent there.
    for (const key of ["access_method", "identity_provider", "password"] as const) {
      expect(remedy(key)?.text, key).toMatch(/^Ask a superadmin to (choose|set) it in Event settings, Registration\.$/);
      expect(remedyFor(READINESS_COPY[key], true)?.link, key).toBe("registration_settings");
      expect(remedyFor(READINESS_COPY[key], true)?.text, key).toMatch(/^(Choose|Set) it in Event settings, Registration\.$/);
      expect(remedyFor(READINESS_COPY[key], false), key).toBe(READINESS_COPY[key].remedy);
    }
    // A check without a place of its own for a superadmin reads the same for everybody.
    expect(remedyFor(READINESS_COPY.mail_provider, true)).toBe(READINESS_COPY.mail_provider.remedy);
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
