// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH } from "../src/constants.js";
import {
  passwordStrengthAuthScript,
  renderAuthPasswordStrengthMeterHtml,
} from "../src/password-strength-script.js";
import {
  PASSWORD_STRENGTH_STRONG,
  PASSWORD_STRENGTH_WEAK,
} from "../src/password-strength-fixtures.js";

const SCRIPT_NONCE = "dGVzdC1zY3JpcHQtbm9uY2U=";

/**
 * Runs the serialized inline script in the jsdom document — the same code the
 * browser executes on /setup and /change-password. String assertions in
 * password-strength.test.ts cannot catch a refactor that breaks how `score`,
 * `tooShortProgressScore`, and `wireMatch` call each other at runtime.
 */
function executeAuthScript(): void {
  const tag = passwordStrengthAuthScript(SCRIPT_NONCE);
  const body = tag.replace(`<script nonce="${SCRIPT_NONCE}">`, "").replace("</script>", "");
  // eslint-disable-next-line no-new-func -- executing our own generated script under test
  new Function(body)();
}

function setInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function meter(): HTMLElement {
  const el = document.getElementById("password-strength");
  expect(el).not.toBeNull();
  return el!;
}

function segmentClasses(): string[] {
  return [...meter().querySelectorAll(".auth-password-strength__segment")].map((s) => s.className);
}

beforeEach(() => {
  document.body.innerHTML = `
    <div class="auth-field">
      <div class="auth-password-slot">
        <input id="password" type="password">
        ${renderAuthPasswordStrengthMeterHtml("password")}
      </div>
    </div>
    <div class="auth-field">
      <input id="confirm_password" type="password">
    </div>`;
  executeAuthScript();
});

describe("passwordStrengthAuthScript in a DOM (jsdom)", () => {
  it("starts empty: meter hidden, no aria-label", () => {
    expect(meter().classList.contains("auth-password-strength--empty")).toBe(true);
    expect(meter().getAttribute("aria-label")).toBeNull();
  });

  it("scores a strong password: 4 segments, label, and aria-label", () => {
    const password = document.getElementById("password") as HTMLInputElement;
    setInput(password, PASSWORD_STRENGTH_STRONG);

    expect(meter().classList.contains("auth-password-strength--empty")).toBe(false);
    expect(meter().getAttribute("aria-label")).toBe("Password strength: Strong");
    expect(meter().querySelector(".auth-password-strength__label")?.textContent).toBe("Strong");
    const strong = segmentClasses().filter((c) => c.includes("__segment--strong"));
    expect(strong).toHaveLength(4);
  });

  it("uses tooShortProgressScore below minlength: partial neutral segments", () => {
    const password = document.getElementById("password") as HTMLInputElement;
    setInput(password, "short");

    expect(meter().querySelector(".auth-password-strength__label")?.textContent).toBe("Too short");
    expect(meter().getAttribute("aria-label")).toBe("Password strength: Too short");
    const tooShort = segmentClasses().filter((c) => c.includes("__segment--tooShort"));
    expect(tooShort.length).toBeGreaterThan(0);
    expect(tooShort.length).toBeLessThan(4);
  });

  it("puts the strength tip in aria-label for a weak password", () => {
    const password = document.getElementById("password") as HTMLInputElement;
    setInput(password, PASSWORD_STRENGTH_WEAK);

    expect(PASSWORD_STRENGTH_WEAK.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
    expect(meter().getAttribute("aria-label")).toBe(
      "Password strength: Weak. Avoid repeated or sequential characters for a stronger score.",
    );
  });

  it("clears the meter when the password is emptied", () => {
    const password = document.getElementById("password") as HTMLInputElement;
    setInput(password, PASSWORD_STRENGTH_STRONG);
    setInput(password, "");

    expect(meter().classList.contains("auth-password-strength--empty")).toBe(true);
    expect(meter().getAttribute("aria-label")).toBeNull();
    expect(segmentClasses().every((c) => c === "auth-password-strength__segment")).toBe(true);
  });

  it("wireMatch: confirm hint reacts to both fields and stays match-only", () => {
    const password = document.getElementById("password") as HTMLInputElement;
    const confirm = document.getElementById("confirm_password") as HTMLInputElement;

    setInput(password, PASSWORD_STRENGTH_STRONG);
    setInput(confirm, "different");
    const hint = document.getElementById("confirm_password-match");
    expect(hint?.textContent).toBe("Passwords do not match yet.");
    expect(hint?.className).toContain("auth-confirm-match--warn");

    // Typing in the password field re-evaluates the hint too.
    setInput(confirm, PASSWORD_STRENGTH_STRONG);
    expect(hint?.textContent).toBe("Passwords match.");
    expect(hint?.className).toContain("auth-confirm-match--ok");

    setInput(password, PASSWORD_STRENGTH_STRONG + "x");
    expect(hint?.textContent).toBe("Passwords do not match yet.");

    // Confirm field gets match feedback only — no second strength meter.
    expect(document.querySelectorAll(".auth-password-strength")).toHaveLength(1);

    // Hint is wired into the confirm field's aria-describedby.
    expect(confirm.getAttribute("aria-describedby")).toContain("confirm_password-match");
  });

  it("clears the confirm hint when confirm is emptied", () => {
    const password = document.getElementById("password") as HTMLInputElement;
    const confirm = document.getElementById("confirm_password") as HTMLInputElement;
    setInput(password, PASSWORD_STRENGTH_STRONG);
    setInput(confirm, "different");
    setInput(confirm, "");
    expect(document.getElementById("confirm_password-match")?.textContent).toBe("");
  });
});
