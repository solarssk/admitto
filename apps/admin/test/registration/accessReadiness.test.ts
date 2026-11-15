import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { READINESS_COPY, readinessCopy } from "../../src/registration/accessReadiness.js";

/** The checks the server reports, read from the file that holds them: the screen has words for each one, and for no other. */
function serverKeys(): string[] {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../web/src/registration/readiness.ts"), "utf8");
  const list = /READINESS_KEYS = \[([^\]]*)\] as const/.exec(source)?.[1] ?? "";
  return [...list.matchAll(/"([a-z_]+)"/g)].map((match) => match[1] ?? "");
}

describe("the words of the checks", () => {
  it("are there for every check the server reports, in its order, and for no other", () => {
    const keys = serverKeys();

    expect(keys).toHaveLength(13);
    expect(Object.keys(READINESS_COPY)).toEqual(keys);
  });

  it("mark the row for bot protection that is not used as information, and no other row", () => {
    const info = Object.entries(READINESS_COPY).filter(([, copy]) => copy.info === true);

    expect(info.map(([key]) => key)).toEqual(["bot_protection_not_used"]);
    expect(READINESS_COPY.bot_protection_not_used.met).toBe("Off for this organisation. The link and password forms have no bot check.");
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
    // The company SSO is set up on the card of the ways in, and the organiser is told which.
    expect(remedy("identity_provider")).toEqual({ text: "Ask a superadmin to choose the identity provider in Organisation settings, External services, Access methods." });
    // A way in is turned on at one place, and the organiser is told which.
    expect(remedy("access_method_enabled")).toEqual({ text: "Ask a superadmin to turn it on in Organisation settings, External services, Access methods." });
    expect(remedy("legal_documents")?.link).toBe("legal");
    expect(remedy("form_questions")?.link).toBe("fields");
    expect(remedy("required_fields")?.link).toBe("fields");
    expect(remedy("event_not_ended")?.link).toBe("event_settings");
    // What is put right on the Access tab itself is said in the sentence: nothing to send the person to.
    expect(remedy("access_method")).toBeUndefined();
    expect(remedy("password")).toBeUndefined();
  });

  it("are plain: no dash that stands for a pause, no code and no name of a service", () => {
    const words = Object.values(READINESS_COPY)
      .flatMap((copy) => [copy.title, copy.met, copy.missing, copy.remedy?.text ?? ""])
      .join("\n");

    expect(words).not.toMatch(/[\u2013\u2014]/);
    expect(words).not.toMatch(/turnstile|cloudflare|smtp|_/i);
  });

  it("name the two rows about the way guests open the form, and never call it a way in", () => {
    expect(READINESS_COPY.access_method.title).toBe("How guests open the form");
    expect(READINESS_COPY.access_method_enabled.title).toBe("The chosen way is turned on");
    expect(JSON.stringify([READINESS_COPY.access_method, READINESS_COPY.access_method_enabled])).not.toMatch(/way in/i);
  });

  it("say the three ways in, and that the company SSO is not set up and keeps the form closed", () => {
    expect(READINESS_COPY.access_method.missing).toBe("Choose how guests open the form: with a link, with a password or with company SSO.");
    expect(READINESS_COPY.identity_provider).toMatchObject({
      title: "Company SSO",
      met: "Company SSO is set up.",
      missing: "Company SSO is not set up, so the form stays closed.",
    });
  });

  it("read a check that the screen does not know yet, so a newer server never leaves a blank row", () => {
    const copy = readinessCopy("something_new");

    expect(copy.title).toBe("Other");
    expect(copy.missing).toBe("Something else that registration needs is missing.");
    expect(readinessCopy("bot_protection")).toBe(READINESS_COPY.bot_protection);
  });
});
