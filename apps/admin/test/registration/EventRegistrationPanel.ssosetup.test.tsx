// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistrationRedirectUriDto, RegistrationSettingsDto } from "../../src/api/types.js";
import { EventRegistrationPanel } from "../../src/registration/EventRegistrationPanel.js";
import { addToast, api, refreshEvent } from "./accessApiMocks.js";
import { settings, ssoChecks } from "./accessData.js";
import { card, resetApi } from "./accessFixtures.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    fetchRegistrationSsoProvider: (...args: unknown[]) => mocks.fetchRegistrationSsoProvider(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: vi.fn() }));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

const INSTANCE: RegistrationRedirectUriDto = { uri: "https://admitto.example.com/sso/callback", host: "instance", verified: true };
const EVENT: RegistrationRedirectUriDto = { uri: "https://summit.acme.example/sso/callback", host: "event_domain", verified: true };
const OTHER_EVENT: RegistrationRedirectUriDto = { uri: "https://other.acme.example/sso/callback", host: "event_domain", verified: true };
const OWN = { domain: "summit.acme.example", status: "ok" as const, check_result: "ok" as const, verified: true, checked_at: null };

const REDIRECT_HINT =
  "Enter this address once at the identity provider, as an allowed redirect (callback) address. It is the same for every event that uses the company SSO on the address of this instance.";
const EVENT_ADDRESS_HINT =
  "Also enter this address at the identity provider. It belongs to the event that uses the company SSO on its own address. Every event address needs its own entry at the identity provider.";
const GATEWAY_NOTE = "If a gateway such as Cloudflare Access stands in front of Admitto, it must let /sso/callback through without a sign-in, together with /r/*.";

const ssoSettings = (overrides: Partial<RegistrationSettingsDto> = {}) => settings({ access_methods: ["sso"], readiness: ssoChecks(), ...overrides });
const css = () => readFileSync(join(__dirname, "../../src/registration/registration-access.css"), "utf8");

async function renderPanel(saved: RegistrationSettingsDto, uris: RegistrationRedirectUriDto[] = [INSTANCE]) {
  api.fetchRegistrationSettings.mockResolvedValue(saved);
  api.fetchRegistrationSsoProvider.mockResolvedValue({ provider_id: "idp-1", state: "ready", providers: [{ id: "idp-1", display_name: "Acme Entra ID", issuer: "https://login.microsoftonline.com/tenant-a/v2.0" }], redirect_uri: null, redirect_uris: uris });
  render(<EventRegistrationPanel eventId="evt-1" archived={false} refreshEvent={refreshEvent} />);
  await screen.findByLabelText("Own address");
}

beforeEach(() => {
  resetApi();
});

afterEach(() => {
  cleanup();
});

const panel = () => card("Company SSO").querySelector("section.access-it") as HTMLElement;
const toggle = () => within(panel()).getByRole("button", { name: "Setup for your IT team" });
const steps = () => [...panel().querySelectorAll("ol.access-steps > li")] as HTMLElement[];
const field = (label: string) => within(panel()).getByLabelText(label) as HTMLInputElement;
const fields = () => panel().querySelectorAll(".access-dns input");
const copyButton = () => within(panel()).getByRole("button", { name: "Copy instructions for an AI agent" });

describe("the setup for IT in the Company SSO card", () => {
  it("is a panel like the one of the address, with the toggle and the copy button in the heading, and shut", async () => {
    await renderPanel(ssoSettings());

    const head = panel().querySelector(".access-it__head") as HTMLElement;
    expect(within(head).getAllByRole("button").map((control) => control.textContent)).toEqual(["Setup for your IT team", "Copy instructions for an AI agent"]);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(panel().querySelector("ul")).toBeNull();
  });

  it.each([
    ["an event that uses the company SSO", () => ssoSettings()],
    ["an event on another way", () => settings({ access_methods: ["link"] })],
  ])("is shut for %s, and opens and closes with its heading", async (_what, make) => {
    await renderPanel(make());

    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("says, in the sentences of the card of the ways in, to enter the return address of the instance and that a gateway must let the callback through", async () => {
    await renderPanel(ssoSettings());

    expect(steps().map((step) => step.querySelector("span")?.textContent ?? step.textContent)).toEqual([REDIRECT_HINT, GATEWAY_NOTE]);
    expect(field("Return address").value).toBe(INSTANCE.uri);
    expect(field("Return address").readOnly).toBe(true);
    expect(field("Return address").classList.contains("access-readonly")).toBe(true);
  });

  it("adds the return address of the event's own address, and no other event's", async () => {
    await renderPanel(ssoSettings({ own_address: OWN }), [INSTANCE, OTHER_EVENT, EVENT]);

    expect(steps().map((step) => step.querySelector("span")?.textContent ?? step.textContent)).toEqual([REDIRECT_HINT, EVENT_ADDRESS_HINT, GATEWAY_NOTE]);
    expect(field("Return address for summit.acme.example").value).toBe(EVENT.uri);
    expect(panel().textContent).not.toContain("other.acme.example");
  });

  it("tells the unverified own address to be entered now", async () => {
    await renderPanel(ssoSettings({ own_address: { ...OWN, status: "unchecked", verified: false } }), [INSTANCE, { ...EVENT, verified: false }]);

    expect(steps()[1]?.querySelector("span")?.textContent).toContain("This address has not passed its check yet. Enter it now so that the sign-in works as soon as it does.");
  });

  it("has no return address of the event while the event has no own address, even when the instance lists others", async () => {
    await renderPanel(ssoSettings(), [INSTANCE, OTHER_EVENT]);

    expect(fields()).toHaveLength(1);
  });

  it("says that the instance has no return address when its address is not set, and leaves the box out", async () => {
    await renderPanel(ssoSettings(), []);

    expect(steps()[0]?.textContent).toBe("There is no return address for this instance yet, because its address is not set.");
    expect(fields()).toHaveLength(0);
  });

  it("adds the claim and its values as saved, and nothing while there is no restriction", async () => {
    await renderPanel(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111", "bbb-222"] }));
    expect(steps().at(-1)?.textContent).toBe("The sign-in must carry the claim tid. Guests may register with one of 2 values: aaa-111, bbb-222.");
    cleanup();

    await renderPanel(ssoSettings({ sso_claim_name: "groups", sso_claim_values: ["staff"] }));
    expect(steps().at(-1)?.textContent).toBe("The sign-in must carry the claim groups. Guests may register with one of 1 value: staff.");
    cleanup();

    await renderPanel(ssoSettings());
    expect(steps().map((step) => step.textContent)).toHaveLength(2);
    expect(panel().textContent).not.toContain("must carry the claim");
  });

  it("copies the whole of it as plain text, return addresses and claim included, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderPanel(ssoSettings({ own_address: OWN, sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }), [INSTANCE, EVENT]);

    fireEvent.click(copyButton());

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      [
        "Set up the company SSO (OpenID Connect) for the guest registration of an event in Admitto.",
        "",
        `1. At the identity provider, add these allowed redirect (callback) addresses: ${INSTANCE.uri}, ${EVENT.uri}`,
        "2. If a gateway such as Cloudflare Access stands in front of Admitto, let /sso/callback through without a sign-in, together with /r/*.",
        "3. The sign-in must carry the claim tid. Guests may register with one of 1 value: aaa-111.",
        "",
        "Report back when it is done.",
      ].join("\n"),
    );
    expect(addToast).toHaveBeenCalledWith("Instructions copied.", "success");
  });

  it("copies a text without the claim and with one address when that is all there is, and without any address when the instance has none", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderPanel(ssoSettings());
    fireEvent.click(copyButton());
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]?.[0]).toContain(`1. At the identity provider, add this allowed redirect (callback) address: ${INSTANCE.uri}\n2. If a gateway`);
    expect(writeText.mock.calls[0]?.[0]).not.toContain("claim");
    cleanup();

    await renderPanel(ssoSettings(), []);
    fireEvent.click(copyButton());
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1]?.[0]).toContain("\n1. If a gateway");
  });

  it("copies one return address from its box, and says when the clipboard refuses", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("no"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderPanel(ssoSettings());
    fireEvent.click(toggle());

    fireEvent.click(within(panel()).getByRole("button", { name: "Copy the return address" }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Copied.", "success"));
    fireEvent.click(within(panel()).getByRole("button", { name: "Copy the return address" }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Could not copy.", "error"));
    expect(writeText).toHaveBeenNthCalledWith(1, INSTANCE.uri);
  });

  it("puts the copy button of a return address on the left of its grey field, in the frame of the field", async () => {
    await renderPanel(ssoSettings());
    fireEvent.click(toggle());

    const group = field("Return address").closest(".at-inputgroup") as HTMLElement;
    expect(group.firstElementChild).toBe(within(group).getByRole("button", { name: "Copy the return address" }));
    expect(css()).toMatch(/\.access-dns--single \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });

  it.each([
    ["with an address", ssoSettings({ own_address: OWN, sso_claim_name: "tid", sso_claim_values: ["aaa-111"] })],
    ["on another way", settings({ access_methods: ["link"] })],
  ])("is free of axe violations %s", async (_what, saved) => {
    await renderPanel(saved, [INSTANCE, EVENT]);
    for (let round = 0; round < 2; round += 1) {
      const result = await axe.run(card("Company SSO"), { rules: { "color-contrast": { enabled: false } } });
      expect(result.violations.map((violation) => violation.id)).toEqual([]);
      fireEvent.click(toggle());
    }
  });
});
