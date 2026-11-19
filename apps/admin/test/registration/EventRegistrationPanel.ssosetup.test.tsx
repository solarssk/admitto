// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistrationRedirectUriDto, RegistrationSettingsDto } from "../../src/api/types.js";
import { EventRegistrationPanel } from "../../src/registration/EventRegistrationPanel.js";
import { deferred, plain } from "../test-utils.js";
import { addToast, api, refreshEvent } from "./accessApiMocks.js";
import { settings, ssoChecks } from "./accessData.js";
import { card, resetApi } from "./accessFixtures.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    fetchLegalDocuments: (...args: unknown[]) => mocks.fetchLegalDocuments(...args),
    fetchRegistrationReturnAddresses: (...args: unknown[]) => mocks.fetchRegistrationReturnAddresses(...args),
    saveCustomDomain: (...args: unknown[]) => mocks.saveCustomDomain(...args),
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
  "Enter this address once at the identity provider, in its list of allowed redirect (callback) addresses. After a guest signs in, the provider sends the guest back to this address. It is the same for every event that uses Company SSO on the address of this instance.";
const EVENT_ADDRESS_HINT =
  "Also enter this address at the identity provider. It belongs to the event that uses Company SSO on its own address. Every event address needs its own entry at the identity provider.";
const GATEWAY_NOTE = "If a gateway such as Cloudflare Access stands in front of Admitto, it must let the paths /sso/callback, /r/* and /legal/* through without asking for a sign-in.";

const ssoSettings = (overrides: Partial<RegistrationSettingsDto> = {}) => settings({ access_methods: ["sso"], readiness: ssoChecks(), ...overrides });
const css = () => readFileSync(join(__dirname, "../../src/registration/registration-access.css"), "utf8");

async function renderPanel(saved: RegistrationSettingsDto, uris: RegistrationRedirectUriDto[] = [INSTANCE]) {
  api.fetchRegistrationSettings.mockResolvedValue(saved);
  api.fetchRegistrationReturnAddresses.mockResolvedValue({ provider_id: "idp-1", state: "ready", providers: [{ id: "idp-1", display_name: "Acme Entra ID", kind: "entra" }], redirect_uri: null, redirect_uris: uris });
  const { rerender } = render(
    <MemoryRouter>
      <EventRegistrationPanel eventId="evt-1" archived={false} superadmin refreshEvent={refreshEvent} addressVersion={0} />
    </MemoryRouter>,
  );
  await screen.findByRole("switch", { name: "Waiting list" });
  return {
    /** The address for guests changed on General: the page gives the panel a new version. */
    addressChanged: (version: number) =>
      rerender(
        <MemoryRouter>
          <EventRegistrationPanel eventId="evt-1" archived={false} superadmin refreshEvent={refreshEvent} addressVersion={version} />
        </MemoryRouter>,
      ),
  };
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

  it("says, in the shared sentences, to enter the return address of the instance and that a gateway must let the callback through", async () => {
    await renderPanel(ssoSettings());

    expect(steps().map((step) => plain(step.querySelector("span")?.textContent ?? step.textContent))).toEqual([REDIRECT_HINT, GATEWAY_NOTE]);
    expect(field("Return address").value).toBe(INSTANCE.uri);
    expect(field("Return address").readOnly).toBe(true);
    expect(field("Return address").classList.contains("access-readonly")).toBe(true);
  });

  it("adds the return address of the event's own address, and no other event's", async () => {
    await renderPanel(ssoSettings({ own_address: OWN }), [INSTANCE, OTHER_EVENT, EVENT]);

    expect(steps().map((step) => plain(step.querySelector("span")?.textContent ?? step.textContent))).toEqual([REDIRECT_HINT, EVENT_ADDRESS_HINT, GATEWAY_NOTE]);
    expect(field("Return address for summit.acme.example").value).toBe(EVENT.uri);
    expect(panel().textContent).not.toContain("other.acme.example");
  });

  describe("when the address for guests changed meanwhile", () => {
    const answer = (uris: RegistrationRedirectUriDto[]) => ({ provider_id: "idp-1", state: "ready" as const, providers: [{ id: "idp-1", display_name: "Acme Entra ID", kind: "entra" as const }], redirect_uri: null, redirect_uris: uris });

    it("shows the new address once the settings and the return addresses are read again", async () => {
      const { addressChanged } = await renderPanel(ssoSettings({ own_address: OWN }), [INSTANCE, EVENT]);
      fireEvent.click(toggle());
      api.fetchRegistrationSettings.mockResolvedValue(ssoSettings({ own_address: { ...OWN, domain: "other.acme.example" } }));
      api.fetchRegistrationReturnAddresses.mockResolvedValue(answer([INSTANCE, OTHER_EVENT]));

      addressChanged(1);

      await waitFor(() => expect(field("Return address for other.acme.example").value).toBe(OTHER_EVENT.uri));
      expect(panel().textContent).not.toContain("summit.acme.example");
    });

    it("shows and copies no old address while the new ones are being read, then the new one", async () => {
      const { addressChanged } = await renderPanel(ssoSettings({ own_address: OWN }), [INSTANCE, EVENT]);
      fireEvent.click(toggle());
      const settingsRead = deferred<RegistrationSettingsDto>();
      const addressesRead = deferred<ReturnType<typeof answer>>();
      api.fetchRegistrationSettings.mockReturnValue(settingsRead.promise);
      api.fetchRegistrationReturnAddresses.mockReturnValue(addressesRead.promise);
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

      addressChanged(1);

      await waitFor(() => expect(within(panel()).queryByLabelText("Return address for summit.acme.example")).toBeNull());
      expect(within(panel()).queryByLabelText("Return address")).toBeNull();
      fireEvent.click(copyButton());
      await waitFor(() => expect(writeText).toHaveBeenCalled());
      expect(String(writeText.mock.calls[0]?.[0])).not.toContain("summit.acme.example");
      expect(String(writeText.mock.calls[0]?.[0])).not.toContain("admitto.example.com/sso/callback");
      await act(async () => {
        settingsRead.resolve(ssoSettings({ own_address: { ...OWN, domain: "other.acme.example" } }));
        addressesRead.resolve(answer([INSTANCE, OTHER_EVENT]));
      });

      await waitFor(() => expect(field("Return address for other.acme.example").value).toBe(OTHER_EVENT.uri));
    });

    it("drops the answer of an older read when the address changed again, and stays busy until the newest read answers", async () => {
      const { addressChanged } = await renderPanel(ssoSettings({ own_address: OWN }), [INSTANCE, EVENT]);
      fireEvent.click(toggle());
      const firstSettings = deferred<RegistrationSettingsDto>();
      const firstAddresses = deferred<ReturnType<typeof answer>>();
      const secondSettings = deferred<RegistrationSettingsDto>();
      const secondAddresses = deferred<ReturnType<typeof answer>>();
      api.fetchRegistrationSettings.mockReturnValueOnce(firstSettings.promise).mockReturnValueOnce(secondSettings.promise);
      api.fetchRegistrationReturnAddresses.mockReturnValueOnce(firstAddresses.promise).mockReturnValueOnce(secondAddresses.promise);
      addressChanged(1);
      await waitFor(() => expect(api.fetchRegistrationReturnAddresses).toHaveBeenCalledTimes(2));
      addressChanged(2);
      await waitFor(() => expect(api.fetchRegistrationReturnAddresses).toHaveBeenCalledTimes(3));

      // The first read answers last-but-one: its answer is not shown, and the setup is still being read.
      await act(async () => {
        firstSettings.resolve(ssoSettings({ own_address: { ...OWN, domain: "first.acme.example" } }));
        firstAddresses.resolve(answer([INSTANCE, { ...EVENT, uri: "https://first.acme.example/sso/callback" }]));
      });
      expect(panel().textContent).not.toContain("first.acme.example");
      expect(within(panel()).queryByLabelText("Return address")).toBeNull();

      await act(async () => {
        secondSettings.resolve(ssoSettings({ own_address: { ...OWN, domain: "other.acme.example" } }));
        secondAddresses.resolve(answer([INSTANCE, OTHER_EVENT]));
      });
      await waitFor(() => expect(field("Return address for other.acme.example").value).toBe(OTHER_EVENT.uri));
    });

    it.each([
      ["both reads fail", true, true],
      ["only the return addresses fail", false, true],
      ["only the settings fail", true, false],
    ])("shows no old address, only a Retry, when %s, and the new address once the Retry works", async (_case, settingsFail, addressesFail) => {
      const { addressChanged } = await renderPanel(ssoSettings({ own_address: OWN }), [INSTANCE, EVENT]);
      fireEvent.click(toggle());
      expect(field("Return address for summit.acme.example")).toBeTruthy();
      if (settingsFail) api.fetchRegistrationSettings.mockRejectedValue(new Error("down"));
      else api.fetchRegistrationSettings.mockResolvedValue(ssoSettings({ own_address: { ...OWN, domain: "other.acme.example" } }));
      if (addressesFail) api.fetchRegistrationReturnAddresses.mockRejectedValue(new Error("down"));
      else api.fetchRegistrationReturnAddresses.mockResolvedValue(answer([INSTANCE, OTHER_EVENT]));

      addressChanged(1);

      expect(await within(panel()).findByText("Could not read the return addresses.")).toBeTruthy();
      expect(panel().textContent).not.toContain("summit.acme.example");
      expect(within(panel()).queryByLabelText("Return address")).toBeNull();
      // Nothing old is copied either.
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      fireEvent.click(copyButton());
      await waitFor(() => expect(writeText).toHaveBeenCalled());
      expect(String(writeText.mock.calls[0]?.[0])).not.toContain("summit.acme.example");
      expect(String(writeText.mock.calls[0]?.[0])).not.toContain("admitto.example.com/sso/callback");
      api.fetchRegistrationSettings.mockResolvedValue(ssoSettings({ own_address: { ...OWN, domain: "other.acme.example" } }));
      api.fetchRegistrationReturnAddresses.mockResolvedValue(answer([INSTANCE, OTHER_EVENT]));

      fireEvent.click(within(panel()).getByRole("button", { name: "Retry reading the return addresses" }));

      await waitFor(() => expect(field("Return address for other.acme.example").value).toBe(OTHER_EVENT.uri));
      expect(within(panel()).queryByText("Could not read the return addresses.")).toBeNull();
    });
  });

  it("tells the unverified own address to be entered now", async () => {
    await renderPanel(ssoSettings({ own_address: { ...OWN, status: "unchecked", verified: false } }), [INSTANCE, { ...EVENT, verified: false }]);

    expect(plain(steps()[1]?.querySelector("span")?.textContent)).toContain("This address has not passed its check yet. Enter it now, so sign-in works as soon as the address passes.");
  });

  it("has no return address of the event while the event has no own address, even when the instance lists others", async () => {
    await renderPanel(ssoSettings(), [INSTANCE, OTHER_EVENT]);

    expect(fields()).toHaveLength(1);
  });

  it("says that the instance has no return address when its address is not set, and leaves the box out", async () => {
    await renderPanel(ssoSettings(), []);

    expect(plain(steps()[0]?.textContent)).toBe("There is no return address yet, because the Instance URL is not set. Set it under General in Organisation settings.");
    expect(fields()).toHaveLength(0);
  });

  it("adds the claim and its values as saved, and nothing while there is no restriction", async () => {
    await renderPanel(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111", "bbb-222"] }));
    expect(plain(steps().at(-1)?.textContent)).toBe("The identity provider must send the claim tid with one of these 2 values: aaa-111, bbb-222. Guests with other values cannot register.");
    cleanup();

    await renderPanel(ssoSettings({ sso_claim_name: "groups", sso_claim_values: ["staff"] }));
    expect(plain(steps().at(-1)?.textContent)).toBe("The identity provider must send the claim groups with this value: staff. Guests with other values cannot register.");
    cleanup();

    await renderPanel(ssoSettings());
    expect(steps().map((step) => step.textContent)).toHaveLength(2);
    expect(panel().textContent).not.toContain("must send the claim");
  });

  it("copies the whole of it as plain text, return addresses and claim included, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderPanel(ssoSettings({ own_address: OWN, sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }), [INSTANCE, EVENT]);

    fireEvent.click(copyButton());

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      [
        "Set up Company SSO (OpenID Connect) for the guest registration of an event in Admitto.",
        "",
        `1. At the identity provider, add these allowed redirect (callback) addresses: ${INSTANCE.uri}, ${EVENT.uri}`,
        "2. If a gateway such as Cloudflare Access stands in front of Admitto, it must let the paths /sso/callback, /r/* and /legal/* through without asking for a sign-in.",
        "3. The identity provider must send the claim tid with this value: aaa-111. Guests with other values cannot register.",
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

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Could not copy. Select the text and copy it by hand.", "error"));
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
