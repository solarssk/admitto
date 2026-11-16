// @vitest-environment jsdom
import axe from "axe-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { EventRegistrationPanel } from "../../src/registration/EventRegistrationPanel.js";
import { useOwnAddress } from "../../src/registration/useOwnAddress.js";
import type { CustomDomainDto, RegistrationOwnAddressDto, RegistrationSettingsDto } from "../../src/api/types.js";
import { getTooltipText, isOff, plain } from "../test-utils.js";
import { addToast, api, refreshEvent } from "./accessApiMocks.js";
import { settings } from "./accessData.js";
import { card, resetApi } from "./accessFixtures.js";

const goToLogin = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    saveRegistrationSettings: (...args: unknown[]) => mocks.saveRegistrationSettings(...args),
    fetchLegalDocuments: (...args: unknown[]) => mocks.fetchLegalDocuments(...args),
    fetchRegistrationSsoProvider: (...args: unknown[]) => mocks.fetchRegistrationSsoProvider(...args),
    saveCustomDomain: (...args: unknown[]) => mocks.saveCustomDomain(...args),
    checkCustomDomain: (...args: unknown[]) => mocks.checkCustomDomain(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: (...args: unknown[]) => goToLogin(...args) }));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

const DOMAIN = "summit.acme.example";

const own = (overrides: Partial<RegistrationOwnAddressDto> = {}): RegistrationOwnAddressDto => ({
  domain: DOMAIN,
  status: "unchecked",
  check_result: null,
  verified: false,
  checked_at: null,
  ...overrides,
});

const state = (overrides: Partial<CustomDomainDto> = {}): CustomDomainDto => ({
  custom_domain: DOMAIN,
  custom_domain_status: "unchecked",
  custom_domain_check_result: null,
  custom_domain_verified_at: null,
  custom_domain_checked_at: null,
  ...overrides,
});

/** The Registration tab of Event settings, read and on screen. */
async function renderPanel(saved: RegistrationSettingsDto = settings(), { archived = false } = {}) {
  api.fetchRegistrationSettings.mockResolvedValue(saved);
  render(<EventRegistrationPanel eventId="evt-1" archived={archived} refreshEvent={refreshEvent} />);
  await screen.findByLabelText("Own address");
}

const addressCard = () => card("Address for guests");
const field = () => screen.getByLabelText("Own address") as HTMLInputElement;
const button = (name: string) => within(addressCard()).getByRole("button", { name });
const type = (value: string) => fireEvent.change(field(), { target: { value } });

beforeEach(() => {
  resetApi();
  goToLogin.mockReset();
  api.fetchRegistrationSsoProvider.mockResolvedValue({ provider_id: null, state: "none", providers: [], redirect_uri: null, redirect_uris: [] });
});

afterEach(() => {
  cleanup();
});


describe("the address card", () => {
  const stepsToggle = () => within(addressCard()).getByRole("button", { name: "Setup for your IT team" });
  const stepsBody = () => document.getElementById(stepsToggle().getAttribute("aria-controls") ?? "none") as HTMLElement;

  it("has the field, and no status, check or remove while the event has no address", async () => {
    await renderPanel(settings());

    expect(field().value).toBe("");
    expect(within(addressCard()).queryByRole("status")).toBeNull();
    expect(within(addressCard()).queryByRole("button", { name: "Check now" })).toBeNull();
    expect(within(addressCard()).queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("lays out the status, then the field with its buttons, then the setup for IT", async () => {
    await renderPanel(settings({ own_address: own({ status: "failing", check_result: "dns_failed" }) }));

    const parts = [within(addressCard()).getByRole("status"), field(), button("Set address"), stepsToggle()];
    const order = parts.map((part) => parts.filter((other) => other !== part && (part.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).length);
    expect(order).toEqual([3, 2, 1, 0]);
  });

  it.each([
    ["has no address yet", settings()],
    ["is not checked yet", settings({ own_address: own() })],
    ["did not pass its check", settings({ own_address: own({ status: "failing", check_result: "dns_failed" }) })],
    ["is working", settings({ own_address: own({ status: "ok", verified: true, check_result: "ok" }) })],
  ])("keeps the setup for IT shut, whatever the address %s", async (_what, saved) => {
    await renderPanel(saved);

    expect(stepsToggle().getAttribute("aria-expanded")).toBe("false");
    expect(stepsBody().hidden).toBe(true);
  });

  it("opens and closes the setup with its heading, and keeps what the person chose when the address is saved", async () => {
    await renderPanel(settings({ own_address: own({ status: "ok", verified: true, check_result: "ok" }) }));
    expect(stepsBody().hidden).toBe(true);

    fireEvent.click(stepsToggle());
    expect(stepsToggle().getAttribute("aria-expanded")).toBe("true");
    expect(stepsBody().hidden).toBe(false);
    fireEvent.click(stepsToggle());
    expect(stepsBody().hidden).toBe(true);
  });

  const recordField = (label: string) => within(addressCard().querySelector(".access-dns") as HTMLElement).getByLabelText(label) as HTMLInputElement;
  const nameBox = () => recordField("Name");

  it("shows the DNS record as three grey read only fields: CNAME, the address and the host of the instance", async () => {
    await renderPanel(settings({ own_address: own() }));

    expect(["Type", "Name", "Target"].map((label) => recordField(label).value)).toEqual(["CNAME", DOMAIN, "admitto.example.com"]);
    for (const label of ["Type", "Name", "Target"]) {
      const box = recordField(label);
      expect(box.readOnly).toBe(true);
      expect(box.classList.contains("access-readonly")).toBe(true);
    }
    expect(within(addressCard()).getByText("Create a CNAME record (a DNS entry that makes one name an alias of another) that points the address to admitto.example.com.")).toBeTruthy();
  });

  it("gives all three fields of the record the same frame, each with its copy button on the left", async () => {
    await renderPanel(settings({ own_address: own() }));
    fireEvent.click(stepsToggle());

    for (const [label, copyName] of [["Type", "Copy the type"], ["Name", "Copy the name"], ["Target", "Copy the target"]]) {
      const group = recordField(label).closest(".at-inputgroup") as HTMLElement;
      expect(group.firstElementChild).toBe(within(group).getByRole("button", { name: copyName }));
      expect(group.firstElementChild?.classList.contains("at-inputgroup__icon--action")).toBe(true);
      expect(recordField(label).classList.contains("access-readonly")).toBe(true);
    }
  });

  it("never shows an empty box: a grey example for the name until there is an address, and for the target when the instance has no host", async () => {
    await renderPanel(settings({ instance_host: null }));
    fireEvent.click(stepsToggle());

    expect(nameBox().value).toBe("");
    expect(nameBox().placeholder).toBe("events.example.com");
    expect(recordField("Target").placeholder).toBe("the address of this instance");
    // The frame is the same, and the button is off until there is a value to copy.
    expect((within(addressCard()).getByRole("button", { name: "Copy the name" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(addressCard()).getByRole("button", { name: "Copy the target" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(addressCard()).getByRole("button", { name: "Copy the type" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(addressCard()).getByText("Create a CNAME record (a DNS entry that makes one name an alias of another) that points the address to the address of this instance.")).toBeTruthy();
  });

  it("follows what is typed when the server would take it, falls back to the saved address when it would not, and to the example when there is none", async () => {
    await renderPanel(settings());
    expect(nameBox().placeholder).toBe("events.example.com");
    expect(nameBox().value).toBe("");

    type("  Summit.ACME.example ");
    expect(nameBox().value).toBe(DOMAIN);

    type("https://nope");
    expect(nameBox().value).toBe("");
  });

  it("keeps the saved address in the record while a mistyped one is in the field", async () => {
    await renderPanel(settings({ own_address: own() }));

    type("not an address");

    expect(nameBox().value).toBe(DOMAIN);
  });

  const text = (name: string, target: string) =>
    [
      "Set up the own address of an event for guest registration in Admitto.",
      "",
      `1. DNS: create a CNAME record (a DNS entry that makes one name an alias of another) from ${name} to ${target}.`,
      `2. Serve HTTPS on ${name} with a valid certificate. Admitto does not issue certificates.`,
      `3. Make sure the web server or proxy passes the original Host header (the address the guest typed) on to Admitto. Keep ${name} open to guests, with no sign-in gateway in front of it.`,
      "",
      "Report back when the address is ready.",
    ].join("\n");

  const copyButton = () => within(addressCard()).getByRole("button", { name: "Copy instructions for an AI agent" });

  it("copies the instructions as plain text, whole in themselves, with the typed address and the host of the instance", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderPanel(settings());
    fireEvent.click(copyButton());
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(text("events.example.com", "admitto.example.com")));
    type(DOMAIN);

    fireEvent.click(copyButton());

    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(text(DOMAIN, "admitto.example.com")));
    expect(addToast).toHaveBeenCalledWith("Instructions copied.", "success");
    expect(writeText.mock.calls.map((call) => String(call[0])).join("\n")).not.toMatch(/\bus\b/);
  });

  it("shows the steps and the record but not the whole text, and puts the button at the right of the heading", async () => {
    await renderPanel(settings());

    expect(addressCard().querySelector("textarea")).toBeNull();
    expect(within(addressCard()).queryByText("Instructions as text")).toBeNull();
    expect(within(addressCard()).queryByRole("button", { name: "Copy" })).toBeNull();
    const head = addressCard().querySelector(".access-it__head") as HTMLElement;
    expect(within(head).getAllByRole("button").map((control) => control.textContent)).toEqual(["Setup for your IT team", "Copy instructions for an AI agent"]);
    expect(css()).toMatch(/\.access-it__head \{[^}]*justify-content: space-between;/);
  });

  it("uses the instance in general in the text when there is no host, and says when it cannot copy", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("no"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderPanel(settings({ instance_host: null }));

    fireEvent.click(copyButton());

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Could not copy. Try again.", "error"));
    expect(writeText.mock.calls[0]?.[0]).toContain("from events.example.com to the address of this instance.");
  });

  it("copies the name, the target and the type, one value each, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderPanel(settings({ own_address: own() }));
    fireEvent.click(stepsToggle());

    fireEvent.click(within(addressCard()).getByRole("button", { name: "Copy the name" }));
    fireEvent.click(within(addressCard()).getByRole("button", { name: "Copy the target" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls.map((call) => call[0])).toEqual([DOMAIN, "admitto.example.com"]);
    fireEvent.click(within(addressCard()).getByRole("button", { name: "Copy the type" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3));
    expect(writeText).toHaveBeenLastCalledWith("CNAME");
    expect(addToast).toHaveBeenCalledWith("Copied.", "success");
  });

  it("says it could not copy when the clipboard refuses", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("no")) }, configurable: true });
    await renderPanel(settings({ own_address: own() }));
    fireEvent.click(stepsToggle());

    fireEvent.click(within(addressCard()).getByRole("button", { name: "Copy the target" }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Could not copy. Select the text and copy it by hand.", "error"));
  });

  it("lists the three steps in one numbered list, the record first", async () => {
    await renderPanel(settings({ own_address: own() }));

    const steps = Array.from(stepsBody().querySelectorAll("ol.access-steps > li"));
    expect(steps.map((step) => step.querySelector(".access-dns") !== null)).toEqual([true, false, false]);
    expect(steps.slice(1).map((step) => plain(step.textContent))).toEqual([
      "Serve HTTPS on the address with a valid certificate. Admitto does not issue certificates.",
      "Make sure the web server or proxy passes the original Host header (the address the guest typed) on to Admitto. Keep the address open to guests, with no sign-in gateway in front of it.",
    ]);
  });

  const css = () => readFileSync(join(__dirname, "../../src/registration/registration-access.css"), "utf8");

  it("sets the toggle and the copy button of the heading to one size, so that they sit on one line", async () => {
    await renderPanel(settings());

    const head = addressCard().querySelector(".access-it__head") as HTMLElement;
    const sizes = within(head).getAllByRole("button").map((control) => control.className.split(" ").filter((name) => /sm$/.test(name)));
    expect(sizes[0]).toHaveLength(1);
    expect(sizes[1]).toEqual(sizes[0]);
  });

  it("sets the setup for IT apart as a help: as wide as the card, white with a fine frame, in the small type, with one padding all round", () => {
    expect(css()).toMatch(/\.access-it \{[^}]*padding: var\(--space-3\) var\(--space-4\);[^}]*font-size: var\(--fs-sm\);[^}]*background: var\(--surface-card, #fff\);/);
    expect(css().match(/\.access-it \{[^}]*\}/)?.[0]).not.toMatch(/max-width/);
  });

  it("makes the record fields the height of every other field, grey and fixed width, in a grid that falls to one column on a narrow screen", () => {
    expect(css()).toMatch(/\.access-dns \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 7rem\) minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    expect(css()).toMatch(/@media \(max-width: 640px\) \{\s*\.access-dns \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    expect(css()).toMatch(/\.at-input\.access-readonly \{[^}]*font-family: var\(--font-mono\);[^}]*background-color: var\(--at-gray-100\);/);
    // No height of its own: the field is the standard one, so it is 36px high like Own address.
    // A field with the copy button on its left is as high as one without (36px), the frame inside that height.
    expect(css()).toMatch(/\.access-dns \.at-inputgroup:has\(\.at-inputgroup__icon--action\) \{\s*box-sizing: border-box;\s*height: var\(--control-h\);/);
    expect(css().match(/\.at-input\.access-readonly \{[^}]*\}/)?.[0]).not.toMatch(/height/);
    expect(css()).toMatch(/\.at-inputgroup:has\(\.at-input\.access-readonly\) \{\s*background: var\(--at-gray-100\);/);
  });

  it("keeps the end of the texts of the steps together, so that none wraps to a lone word", async () => {
    await renderPanel(settings({ own_address: own() }));

    const host = [...addressCard().querySelectorAll("ol.access-steps > li")].find((step) => step.textContent?.startsWith("Make sure the web server")) as HTMLElement;
    expect(host.textContent?.endsWith("front\u00A0of\u00A0it.")).toBe(true);
    expect(document.getElementById(field().getAttribute("aria-describedby") ?? "none")?.textContent?.endsWith("Save\u00A0below.")).toBe(true);
  });

  const fieldHint = "The host name only, such as events.example.com. The buttons act at once, not with Save below.";

  it("puts the field, Set address, Check now and Remove in one row once an address is set, and only the field and Set address before", async () => {
    await renderPanel(settings({ own_address: own() }));

    const row = field().closest(".access-address__row") as HTMLElement;
    expect(row.closest(".mail-transport-section > .mail-field-row")).not.toBeNull();
    expect(within(row).getAllByRole("button").map((control) => control.textContent)).toEqual(["Set address", "Check now", "Remove"]);
    expect(css()).toMatch(/\.access-address__row \{[^}]*display: flex;[^}]*flex-wrap: wrap;/);
    // The whole row is half of the card; the field gives way and the buttons keep their width, and wrap under the field when they do not fit.
    expect(css()).toMatch(/\.access-address__row \{[^}]*max-width: 50%;/);
    expect(css()).toMatch(/\.access-address__row > \.access-address__field \{[^}]*flex: 1 1 0;[^}]*min-width: min\(8rem, 100%\);/);
    expect(css()).toMatch(/\.access-address__row > \.at-btn \{[^}]*flex: none;/);
    expect(css()).toMatch(/@media \(max-width: 640px\) \{\s*\.access-address__row \{[^}]*max-width: none;/);
    cleanup();

    await renderPanel(settings());
    const first = field().closest(".access-address__row") as HTMLElement;
    expect(within(first).getAllByRole("button").map((control) => control.textContent)).toEqual(["Set address"]);
  });

  it("says in one hint under the row that the buttons act at once and are not part of the Save of the page", async () => {
    await renderPanel(settings());

    expect(plain(document.getElementById(field().getAttribute("aria-describedby") ?? "none")?.textContent)).toBe(fieldHint);
    expect(addressCard().querySelector(".access-address__buttons")).toBeNull();
  });

  it("has one hint under the row, in the at-hint style, and none about Check now, which the status and the IT panel already say", async () => {
    await renderPanel(settings({ own_address: own() }));

    const hints = [...addressCard().querySelectorAll(".access-address__row ~ .at-hint")];
    expect(hints).toHaveLength(1);
    expect(hints[0]?.previousElementSibling?.className).toBe("access-address__row");
    expect(addressCard().textContent).not.toContain("When IT is done");
    expect(within(stepsBody()).queryByText(/Select Check now/)).toBeNull();
  });

  it("shows the status as a row of the checklist: the icon beside two lines, the title and one description that ends with when it was last checked in UTC", async () => {
    await renderPanel(settings({ own_address: own({ status: "failing", check_result: "dns_failed", checked_at: "2026-11-15T11:46:00.000Z" }) }));

    const status = within(addressCard()).getByRole("status");
    const body = status.querySelector(".overview-check__body") as HTMLElement;
    expect([...body.children].map((child) => child.tagName)).toEqual(["STRONG", "SPAN"]);
    expect(plain(body.children[1]?.textContent)).toMatch(/^The name does not resolve\. Ask IT to add a CNAME to admitto\.example\.com\. Last checked .*UTC\.$/);
    expect(body.children[1]?.textContent).not.toMatch(/main address/);
    // The row is the checklist's own (.access-check with the overview icon and body), with no layout of its own.
    expect(status.classList.contains("access-check")).toBe(true);
    expect(css()).not.toMatch(/\.access-address__status[^{]*\{[^}]*(display: grid|display: contents)/);
    expect(css()).toMatch(/\.access-address__controls \{[^}]*display: contents;/);
    // The icon is centred on the block of the title and the description.
    expect(css()).toMatch(/\.access-address__status \{[^}]*align-items: center;/);
    // What the state means for the links of guests is said once, in the intro, not in every status.
    expect(plain(addressCard().querySelector(".settings-card-intro")?.textContent)).toContain("If it later stops working, fix it or remove it: guests are still sent links on it.");
  });

  it("puts the setup for IT in a panel of its own, the steps under its heading", async () => {
    await renderPanel(settings());

    const panel = addressCard().querySelector("section.access-it") as HTMLElement;
    expect(panel.querySelector("ul")).toBeNull();
    expect(panel.querySelectorAll("ol.access-steps > li")).toHaveLength(3);
  });

  it.each([
    ["new", settings()],
    ["working", settings({ own_address: own({ status: "ok", verified: true, check_result: "ok" }) })],
  ])("is free of axe violations, with the setup open and shut (%s)", async (_what, saved) => {
    await renderPanel(saved);
    for (let round = 0; round < 2; round += 1) {
      const result = await axe.run(addressCard(), { rules: { "color-contrast": { enabled: false } } });
      expect(result.violations.map((violation) => violation.id)).toEqual([]);
      fireEvent.click(stepsToggle());
    }
  });
});

describe("saving the address", () => {
  it("keeps Save off while nothing is typed, and judges what is typed when the field is left", async () => {
    await renderPanel(settings());
    expect(isOff(button("Set address"))).toBe(true);

    type("https://summit.acme.example");
    expect(screen.queryByText(/Enter the host name only/)).toBeNull();
    fireEvent.blur(field());
    expect(screen.getByText(/Enter the host name only/)).toBeTruthy();
    expect(isOff(button("Set address"))).toBe(false);

    fireEvent.click(button("Set address"));
    expect(api.saveCustomDomain).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter the host name only/)).toBeTruthy();
  });

  it("refuses the host of the instance before it asks the server", async () => {
    await renderPanel(settings());
    type("Admitto.example.com");
    fireEvent.blur(field());

    expect(screen.getByText("This is the address of this instance. Guests need an address of their own for this event.")).toBeTruthy();
  });

  it("saves the name as it is stored, says so, and shows the address as not checked yet, with the settings read again", async () => {
    api.saveCustomDomain.mockResolvedValue(state());
    await renderPanel(settings());
    api.fetchRegistrationSettings.mockClear();
    api.fetchRegistrationSettings.mockResolvedValue(settings({ own_address: own() }));

    type("  Summit.ACME.example ");
    fireEvent.click(button("Set address"));

    await waitFor(() => expect(api.saveCustomDomain).toHaveBeenCalledWith("evt-1", DOMAIN));
    expect(await within(addressCard()).findByText(`${DOMAIN}: Not checked yet`)).toBeTruthy();
    expect(field().value).toBe(DOMAIN);
    expect(addToast).toHaveBeenCalledWith("Address set. Check it once IT has set it up.", "success");
    expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(1);
    expect(button("Remove")).toBeTruthy();
  });

  it("keeps Save off for the address that is saved", async () => {
    await renderPanel(settings({ own_address: own() }));
    expect(field().value).toBe(DOMAIN);
    expect(isOff(button("Set address"))).toBe(true);
    type("other.acme.example");
    expect(isOff(button("Set address"))).toBe(false);
  });

  it.each([
    ["custom_domain_taken", 409, "Another event already uses this address. One address belongs to one event."],
    ["custom_domain_invalid", 422, "This is not an address guests can use."],
  ])("says what the server refused with %s, at the field, and keeps what was typed", async (code, status, text) => {
    api.saveCustomDomain.mockRejectedValue(new ApiError(status, code, code));
    await renderPanel(settings());

    type(DOMAIN);
    fireEvent.click(button("Set address"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(text);
    expect(field().value).toBe(DOMAIN);
    // A new edit takes the sentence about the last try away.
    type("other.acme.example");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hands a lost session to the sign-in", async () => {
    api.saveCustomDomain.mockRejectedValue(new ApiError(401, "unauthorized"));
    await renderPanel(settings());

    type(DOMAIN);
    fireEvent.click(button("Set address"));

    await waitFor(() => expect(goToLogin).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reads the event again when the event turns out to be archived", async () => {
    api.saveCustomDomain.mockRejectedValue(new ApiError(403, "event_archived", "event_archived"));
    await renderPanel(settings());

    type(DOMAIN);
    fireEvent.click(button("Set address"));

    await screen.findByRole("alert");
    expect(refreshEvent).toHaveBeenCalled();
  });
});

describe("checking the address", () => {
  it("asks the server, shows what it found, and takes the new link for guests from the settings it reads again", async () => {
    const verified = state({
      custom_domain_status: "ok",
      custom_domain_check_result: "ok",
      custom_domain_verified_at: "2026-11-12T10:00:00.000Z",
      custom_domain_checked_at: "2026-11-12T10:00:00.000Z",
    });
    api.checkCustomDomain.mockResolvedValue(verified);
    await renderPanel(settings({ own_address: own() }));
    api.fetchRegistrationSettings.mockResolvedValue(
      settings({ guest_url: `https://${DOMAIN}/r/demo`, own_address: own({ status: "ok", verified: true, check_result: "ok", checked_at: "2026-11-12T10:00:00.000Z" }) }),
    );

    fireEvent.click(button("Check now"));

    await waitFor(() => expect(api.checkCustomDomain).toHaveBeenCalledWith("evt-1"));
    expect(await within(addressCard()).findByText(`${DOMAIN}: Working`)).toBeTruthy();
  });

  it("tells what a failed check found, and what to ask IT", async () => {
    api.checkCustomDomain.mockResolvedValue(state({ custom_domain_status: "failing", custom_domain_check_result: "dns_failed", custom_domain_checked_at: "2026-11-12T10:00:00.000Z" }));
    await renderPanel(settings({ own_address: own() }));
    api.fetchRegistrationSettings.mockResolvedValue(settings({ own_address: own({ status: "failing", check_result: "dns_failed", checked_at: "2026-11-12T10:00:00.000Z" }) }));

    fireEvent.click(button("Check now"));

    expect(await within(addressCard()).findByText(`${DOMAIN}: Not working yet`)).toBeTruthy();
    expect(within(addressCard()).getByText(/Ask IT to add a CNAME to admitto.example.com\./)).toBeTruthy();
  });

  it("is off, with the reason, while the field holds an address that is not saved", async () => {
    await renderPanel(settings({ own_address: own() }));
    type("other.acme.example");

    expect(isOff(button("Check now"))).toBe(true);
    expect(getTooltipText(button("Check now"))).toBe("Set the address first. The check asks the address that is set.");
  });

  it("says it could not check, and says too many when the limit is reached", async () => {
    api.checkCustomDomain.mockRejectedValueOnce(new ApiError(429, "domain_check_rate_limited", "domain_check_rate_limited"));
    await renderPanel(settings({ own_address: own() }));

    fireEvent.click(button("Check now"));

    expect((await screen.findByRole("alert")).textContent).toBe("Too many checks right now. Wait a minute and try again.");
  });
});

describe("removing the address", () => {
  it("asks first, then removes it, says so, and goes back to a card with no address", async () => {
    api.saveCustomDomain.mockResolvedValue(state({ custom_domain: null }));
    await renderPanel(settings({ own_address: own({ status: "ok", verified: true, check_result: "ok" }) }));
    api.fetchRegistrationSettings.mockResolvedValue(settings());

    fireEvent.click(button("Remove"));
    const dialog = await screen.findByRole("dialog", { name: "Remove the event's own address?" });
    expect(api.saveCustomDomain).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(api.saveCustomDomain).toHaveBeenCalledWith("evt-1", null));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(addToast).toHaveBeenCalledWith("Address removed. Guests get links on the main address.", "success");
    expect(within(addressCard()).queryByRole("status")).toBeNull();
    expect(field().value).toBe("");
  });

  it("can be called off", async () => {
    await renderPanel(settings({ own_address: own() }));

    fireEvent.click(button("Remove"));
    const dialog = await screen.findByRole("dialog", { name: "Remove the event's own address?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.saveCustomDomain).not.toHaveBeenCalled();
  });

  it("keeps the question open and says why when the removal fails", async () => {
    api.saveCustomDomain.mockRejectedValue(new ApiError(500, "internal_error", "internal_error"));
    await renderPanel(settings({ own_address: own() }));

    fireEvent.click(button("Remove"));
    const dialog = await screen.findByRole("dialog", { name: "Remove the event's own address?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(within(dialog).getByText(/Something went wrong/)).toBeTruthy());
    expect(screen.getByRole("dialog", { name: "Remove the event's own address?" })).toBeTruthy();
  });
});

describe("an archived event", () => {
  it("is read only: the buttons are off, with the reason", async () => {
    await renderPanel(settings({ own_address: own() }), { archived: true });

    for (const name of ["Set address", "Check now", "Remove"]) expect(isOff(button(name))).toBe(true);
    expect(field().disabled).toBe(true);
    expect(getTooltipText(button("Check now"))).toBe("This event is archived. Editing is disabled.");
  });
});

describe("the typed address and the first effects of the card", () => {
  type Api = ReturnType<typeof useOwnAddress>;

  /** Types in the layout phase of the first commit, which is before React has flushed that commit's passive effects: the order of a
   * person who types the moment the card is on screen on a machine that is slow to run its effects (a loaded CI runner). */
  function TypesBeforeTheEffects({ onApi }: { onApi: (api: Api) => void }) {
    const result = useOwnAddress({ eventId: "evt-1", saved: null, instanceHost: "admitto.example.com", onChanged: vi.fn(), onArchived: vi.fn() });
    const typed = useRef(false);
    useLayoutEffect(() => {
      if (typed.current) return;
      typed.current = true;
      result.edit("Admitto.example.com");
      result.leave();
    });
    onApi(result);
    return null;
  }

  it("keeps what was typed and judges it, as the reset to the saved address is for a change of that address only", () => {
    let latest: Api | undefined;
    render(<TypesBeforeTheEffects onApi={(result) => (latest = result)} />);

    expect(latest?.typed).toBe("Admitto.example.com");
    expect(latest?.fieldError).toBe("This is the address of this instance. Guests need an address of their own for this event.");
  });
});
