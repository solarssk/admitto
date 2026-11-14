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
import { getTooltipText, isOff } from "../test-utils.js";
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

    const parts = [within(addressCard()).getByRole("status"), field(), button("Save address"), stepsToggle()];
    const order = parts.map((part) => parts.filter((other) => other !== part && (part.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).length);
    expect(order).toEqual([3, 2, 1, 0]);
  });

  it.each([
    ["has no address yet", settings(), true],
    ["is not checked yet", settings({ own_address: own() }), true],
    ["did not pass its check", settings({ own_address: own({ status: "failing", check_result: "dns_failed" }) }), true],
    ["is working", settings({ own_address: own({ status: "ok", verified: true, check_result: "ok" }) }), false],
  ])("opens the setup for IT by itself only when the address %s", async (_what, saved, expanded) => {
    await renderPanel(saved);

    expect(stepsToggle().getAttribute("aria-expanded")).toBe(String(expanded));
    expect(stepsBody().hidden).toBe(!expanded);
  });

  it("opens and closes the setup with its heading, and keeps what the person chose when the address is saved", async () => {
    await renderPanel(settings({ own_address: own({ status: "ok", verified: true, check_result: "ok" }) }));

    fireEvent.click(stepsToggle());
    expect(stepsToggle().getAttribute("aria-expanded")).toBe("true");
    expect(stepsBody().hidden).toBe(false);
    fireEvent.click(stepsToggle());
    expect(stepsBody().hidden).toBe(true);
  });

  const cellOf = (label: string) => addressCard().querySelector(`.access-dns__cell[data-label="${label}"]`) as HTMLElement;

  it("shows the DNS record as one row of three boxes: CNAME, the address and the host of the instance", async () => {
    await renderPanel(settings({ own_address: own() }));

    expect(["Type", "Name", "Target"].map((label) => cellOf(label).textContent)).toEqual(["CNAME", DOMAIN, "admitto.example.com"]);
    expect(within(addressCard()).getAllByRole("columnheader").map((head) => head.textContent)).toEqual(["Type", "Name", "Target"]);
    expect(addressCard().querySelectorAll(".access-dns__row:not(.access-dns__row--head)")).toHaveLength(1);
    expect(within(addressCard()).getByText("Create a CNAME record that points the address to admitto.example.com.")).toBeTruthy();
  });

  it("never shows an empty box: a grey example for the name until there is an address, and for the target when the instance has no host", async () => {
    await renderPanel(settings({ instance_host: null }));

    expect(cellOf("Name").textContent).toBe("events.example.com");
    expect(cellOf("Name").querySelector(".access-dns__value--placeholder")).not.toBeNull();
    expect(cellOf("Target").textContent).toBe("the address of this instance");
    expect(cellOf("Target").querySelector(".access-dns__value--placeholder")).not.toBeNull();
    expect(addressCard().querySelectorAll(".access-dns__copy")).toHaveLength(0);
    expect(within(addressCard()).getByText("Create a CNAME record that points the address to the address of this instance.")).toBeTruthy();
  });

  it("follows what is typed when the server would take it, falls back to the saved address when it would not, and to the example when there is none", async () => {
    await renderPanel(settings());
    expect(cellOf("Name").textContent).toBe("events.example.com");

    type("  Summit.ACME.example ");
    expect(cellOf("Name").textContent).toBe(DOMAIN);
    expect(cellOf("Name").querySelector(".access-dns__value--placeholder")).toBeNull();

    type("https://nope");
    expect(cellOf("Name").textContent).toBe("events.example.com");
  });

  it("keeps the saved address in the record while a mistyped one is in the field", async () => {
    await renderPanel(settings({ own_address: own() }));

    type("not an address");

    expect(cellOf("Name").textContent).toBe(DOMAIN);
  });

  it("copies all the instructions as plain text for a mail, with the typed address and the host of the instance", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderPanel(settings());
    type(DOMAIN);

    fireEvent.click(within(addressCard()).getByRole("button", { name: "Copy instructions" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      [
        "Please set up an address for guest registration:",
        "",
        `1. Create a CNAME record: ${DOMAIN} -> admitto.example.com`,
        "2. Serve HTTPS on the address with a valid certificate. Admitto does not issue certificates.",
        "3. Pass the Host header on to Admitto, and keep the address open to guests, outside any sign-in gateway.",
        "",
        "Tell us when it is ready.",
      ].join("\n"),
    );
    expect(addToast).toHaveBeenCalledWith("Instructions copied.", "success");
  });

  it("uses the example and the instance in general in the copied text when there is no address and no host, and says when it cannot copy", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("no"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderPanel(settings({ instance_host: null }));

    fireEvent.click(within(addressCard()).getByRole("button", { name: "Copy instructions" }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Could not copy.", "error"));
    expect(writeText.mock.calls[0]?.[0]).toContain("1. Create a CNAME record: events.example.com -> the address of this instance");
  });

  it("copies the name and the target, and not the type, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderPanel(settings({ own_address: own() }));

    fireEvent.click(within(addressCard()).getByRole("button", { name: "Copy the name" }));
    fireEvent.click(within(addressCard()).getByRole("button", { name: "Copy the target" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls.map((call) => call[0])).toEqual([DOMAIN, "admitto.example.com"]);
    expect(within(addressCard()).queryByRole("button", { name: "Copy the type" })).toBeNull();
    expect(addToast).toHaveBeenCalledWith("Copied.", "success");
  });

  it("says it could not copy when the clipboard refuses", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("no")) }, configurable: true });
    await renderPanel(settings({ own_address: own() }));

    fireEvent.click(within(addressCard()).getByRole("button", { name: "Copy the target" }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Could not copy.", "error"));
  });

  it("lists the four steps in one numbered list, the record first", async () => {
    await renderPanel(settings({ own_address: own() }));

    const steps = Array.from(stepsBody().querySelectorAll("ol.access-steps > li"));
    expect(steps.map((step) => step.querySelector(".access-dns") !== null)).toEqual([true, false, false, false]);
    expect(steps.slice(1).map((step) => step.textContent)).toEqual([
      "Serve HTTPS on the address with a valid certificate. Admitto does not issue certificates.",
      "Pass the Host header on to Admitto, and keep the address open to guests, outside any sign-in gateway.",
      "Select Check now. Guests get links on the address once the check passes. Until then they keep the main address.",
    ]);
  });

  const css = () => readFileSync(join(__dirname, "../../src/registration/registration-access.css"), "utf8");

  it("makes each box of the record as high as a field, in one row with equal gaps, and falls to one column on a narrow screen", () => {
    expect(css()).toMatch(/\.access-dns__cell \{[^}]*box-sizing: border-box;[^}]*height: var\(--control-h\);/);
    expect(css()).toMatch(/\.access-dns__row \{[^}]*grid-template-columns: minmax\(0, 7rem\) minmax\(0, 1fr\) minmax\(0, 1fr\);[^}]*gap: var\(--space-3\);/);
    expect(css()).toMatch(/@media \(max-width: 640px\) \{\s*\.access-dns__row \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    // The copy button sits inside the box and is smaller than it, so it cannot make it taller.
    expect(css()).toMatch(/\.access-dns__copy \{[^}]*width: 1\.5rem;[^}]*height: 1\.5rem;/);
  });

  it("puts Save address, Check now and Remove in one row with the field, which takes half of the card", async () => {
    await renderPanel(settings({ own_address: own() }));

    const row = field().closest(".access-address__row") as HTMLElement;
    expect(within(row).getAllByRole("button").map((control) => control.textContent)).toEqual(["Save address", "Check now", "Remove"]);
    expect(field().closest(".access-address__input")?.parentElement).toBe(row);
    expect(css()).toMatch(/\.access-address__input \{[^}]*flex: 0 1 calc\(\(100% - var\(--space-4\)\) \/ 2\);/);
    expect(css()).toMatch(/@media \(max-width: 640px\) \{\s*\.access-address__input \{\s*flex-basis: 100%;/);
  });

  it("has only Save address beside the field until an address is saved", async () => {
    await renderPanel(settings());

    const row = field().closest(".access-address__row") as HTMLElement;
    expect(within(row).getAllByRole("button").map((control) => control.textContent)).toEqual(["Save address"]);
  });

  it("puts the setup for IT in a panel of its own with Copy instructions at the right of its heading", async () => {
    await renderPanel(settings());

    const panel = addressCard().querySelector("section.access-it") as HTMLElement;
    const head = panel.querySelector(".access-it__head") as HTMLElement;
    expect(within(head).getAllByRole("button").map((control) => control.textContent)).toEqual(["Setup for your IT team", "Copy instructions"]);
    expect(panel.querySelector("ul")).toBeNull();
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
    expect(isOff(button("Save address"))).toBe(true);

    type("https://summit.acme.example");
    expect(screen.queryByText(/Enter the host name only/)).toBeNull();
    fireEvent.blur(field());
    expect(screen.getByText(/Enter the host name only/)).toBeTruthy();
    expect(isOff(button("Save address"))).toBe(false);

    fireEvent.click(button("Save address"));
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
    fireEvent.click(button("Save address"));

    await waitFor(() => expect(api.saveCustomDomain).toHaveBeenCalledWith("evt-1", DOMAIN));
    expect(await within(addressCard()).findByText(`${DOMAIN}: Not checked yet`)).toBeTruthy();
    expect(field().value).toBe(DOMAIN);
    expect(addToast).toHaveBeenCalledWith("Address saved. Check it once IT has set it up.", "success");
    expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(1);
    expect(button("Remove")).toBeTruthy();
  });

  it("keeps Save off for the address that is saved", async () => {
    await renderPanel(settings({ own_address: own() }));
    expect(field().value).toBe(DOMAIN);
    expect(isOff(button("Save address"))).toBe(true);
    type("other.acme.example");
    expect(isOff(button("Save address"))).toBe(false);
  });

  it.each([
    ["custom_domain_taken", 409, "Another event already uses this address. One address belongs to one event."],
    ["custom_domain_invalid", 422, "This is not an address guests can use."],
  ])("says what the server refused with %s, at the field, and keeps what was typed", async (code, status, text) => {
    api.saveCustomDomain.mockRejectedValue(new ApiError(status, code, code));
    await renderPanel(settings());

    type(DOMAIN);
    fireEvent.click(button("Save address"));

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
    fireEvent.click(button("Save address"));

    await waitFor(() => expect(goToLogin).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reads the event again when the event turns out to be archived", async () => {
    api.saveCustomDomain.mockRejectedValue(new ApiError(403, "event_archived", "event_archived"));
    await renderPanel(settings());

    type(DOMAIN);
    fireEvent.click(button("Save address"));

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
    expect(within(addressCard()).getByText(/Ask IT to create a CNAME record that points it to admitto.example.com\./)).toBeTruthy();
  });

  it("is off, with the reason, while the field holds an address that is not saved", async () => {
    await renderPanel(settings({ own_address: own() }));
    type("other.acme.example");

    expect(isOff(button("Check now"))).toBe(true);
    expect(getTooltipText(button("Check now"))).toBe("Save the address first. The check asks the address that is saved.");
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
    const dialog = await screen.findByRole("dialog", { name: "Remove the own address?" });
    expect(api.saveCustomDomain).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove address" }));

    await waitFor(() => expect(api.saveCustomDomain).toHaveBeenCalledWith("evt-1", null));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(addToast).toHaveBeenCalledWith("Address removed. Guests get links on the main address.", "success");
    expect(within(addressCard()).queryByRole("status")).toBeNull();
    expect(field().value).toBe("");
  });

  it("can be called off", async () => {
    await renderPanel(settings({ own_address: own() }));

    fireEvent.click(button("Remove"));
    const dialog = await screen.findByRole("dialog", { name: "Remove the own address?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.saveCustomDomain).not.toHaveBeenCalled();
  });

  it("keeps the question open and says why when the removal fails", async () => {
    api.saveCustomDomain.mockRejectedValue(new ApiError(500, "internal_error", "internal_error"));
    await renderPanel(settings({ own_address: own() }));

    fireEvent.click(button("Remove"));
    const dialog = await screen.findByRole("dialog", { name: "Remove the own address?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove address" }));

    await waitFor(() => expect(within(dialog).getByText(/Something went wrong/)).toBeTruthy());
    expect(screen.getByRole("dialog", { name: "Remove the own address?" })).toBeTruthy();
  });
});

describe("an archived event", () => {
  it("is read only: the buttons are off, with the reason", async () => {
    await renderPanel(settings({ own_address: own() }), { archived: true });

    for (const name of ["Save address", "Check now", "Remove"]) expect(isOff(button(name))).toBe(true);
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
