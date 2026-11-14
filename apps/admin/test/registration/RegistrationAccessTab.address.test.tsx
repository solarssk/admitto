// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { useOwnAddress } from "../../src/registration/useOwnAddress.js";
import type { CustomDomainDto, RegistrationOwnAddressDto, RoleAssignment } from "../../src/api/types.js";
import { getTooltipText, isOff } from "../test-utils.js";
import { addToast, api, refreshEvent } from "./accessApiMocks.js";
import { archivedEvent, settings } from "./accessData.js";
import { card, renderLoaded, resetApi } from "./accessFixtures.js";

const goToLogin = vi.fn();
let assignments: RoleAssignment[] = [];

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    saveRegistrationSettings: (...args: unknown[]) => mocks.saveRegistrationSettings(...args),
    fetchLegalDocuments: (...args: unknown[]) => mocks.fetchLegalDocuments(...args),
    fetchRegistrationCounts: (...args: unknown[]) => mocks.fetchRegistrationCounts(...args),
    saveCustomDomain: (...args: unknown[]) => mocks.saveCustomDomain(...args),
    checkCustomDomain: (...args: unknown[]) => mocks.checkCustomDomain(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: (...args: unknown[]) => goToLogin(...args) }));
vi.mock("../../src/auth/AuthProvider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/auth/AuthProvider.js")>()),
  useOptionalAuth: () => ({ assignments }),
}));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

const SUPERADMIN: RoleAssignment = { role: "superadmin", scope_type: "instance", scope_id: null };
const ORG_ADMIN: RoleAssignment = { role: "admin", scope_type: "organization", scope_id: "org-1" };
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

const addressCard = () => card("Address for guests");
const field = () => screen.getByLabelText("Own address") as HTMLInputElement;
const button = (name: string) => within(addressCard()).getByRole("button", { name });
const type = (value: string) => fireEvent.change(field(), { target: { value } });

beforeEach(() => {
  resetApi();
  goToLogin.mockReset();
  assignments = [SUPERADMIN];
});

afterEach(() => {
  cleanup();
});

describe("the address card: who sees what", () => {
  it("is not there for an administrator of the organisation when the event has no address of its own", async () => {
    assignments = [ORG_ADMIN];
    await renderLoaded(settings());

    expect(screen.queryByText("Address for guests", { selector: ".at-card__title" })).toBeNull();
  });

  it("shows an administrator of the organisation how the address stands, and no way to change it", async () => {
    assignments = [ORG_ADMIN];
    await renderLoaded(settings({ own_address: own({ status: "ok", verified: true, check_result: "ok", checked_at: "2026-11-12T10:00:00.000Z" }) }));

    const shown = addressCard();
    expect(within(shown).getByText(`${DOMAIN}: Working`)).toBeTruthy();
    expect(within(shown).getByText(/^Last checked .*10:00.* UTC\.$/)).toBeTruthy();
    expect(within(shown).getByText("A superadmin changes this address.")).toBeTruthy();
    expect(screen.queryByLabelText("Own address")).toBeNull();
    expect(within(shown).queryByRole("button")).toBeNull();
  });

  it("gives a superadmin the field, the steps for IT, and the host to point the name at, even when the event has no address", async () => {
    await renderLoaded(settings());

    expect(field().value).toBe("");
    expect(within(addressCard()).getByText("What IT sets up")).toBeTruthy();
    expect(within(addressCard()).getByText("Create a CNAME record that points the address to admitto.example.com.")).toBeTruthy();
    expect(within(addressCard()).queryByRole("status")).toBeNull();
    expect(within(addressCard()).queryByRole("button", { name: "Check now" })).toBeNull();
    expect(within(addressCard()).queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("names the instance in general when it has no host", async () => {
    await renderLoaded(settings({ instance_host: null }));
    expect(within(addressCard()).getByText("Create a CNAME record that points the address to the address of this instance.")).toBeTruthy();
  });
});

describe("the warning that an address stopped working", () => {
  const warning = () => screen.queryByText(/stopped working:/);

  it("is told to an administrator of the organisation, with the reason", async () => {
    assignments = [ORG_ADMIN];
    await renderLoaded(settings({ own_address: own({ status: "failing", verified: true, check_result: "tls_failed" }) }));

    expect(warning()?.textContent).toContain("its HTTPS certificate is refused");
    expect(warning()?.closest(".at-notice--warning")).not.toBeNull();
  });

  it.each([
    ["an address that works", own({ status: "ok", verified: true, check_result: "ok" })],
    ["an address that never worked", own({ status: "failing", verified: false, check_result: "dns_failed" })],
    ["an address that is not checked", own()],
    ["no address", null],
  ])("is not told for %s", async (_what, address) => {
    await renderLoaded(settings({ own_address: address }));
    expect(warning()).toBeNull();
  });
});

describe("saving the address", () => {
  it("keeps Save off while nothing is typed, and judges what is typed when the field is left", async () => {
    await renderLoaded(settings());
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
    await renderLoaded(settings());
    type("Admitto.example.com");
    fireEvent.blur(field());

    expect(screen.getByText("This is the address of this instance. Guests need an address of their own for this event.")).toBeTruthy();
  });

  it("saves the name as it is stored, says so, and shows the address as not checked yet, with the settings read again", async () => {
    api.saveCustomDomain.mockResolvedValue(state());
    await renderLoaded(settings());
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
    await renderLoaded(settings({ own_address: own() }));
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
    await renderLoaded(settings());

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
    await renderLoaded(settings());

    type(DOMAIN);
    fireEvent.click(button("Save address"));

    await waitFor(() => expect(goToLogin).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reads the event again when the event turns out to be archived", async () => {
    api.saveCustomDomain.mockRejectedValue(new ApiError(403, "event_archived", "event_archived"));
    await renderLoaded(settings());

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
    await renderLoaded(settings({ own_address: own() }));
    api.fetchRegistrationSettings.mockResolvedValue(
      settings({ guest_url: `https://${DOMAIN}/r/demo`, own_address: own({ status: "ok", verified: true, check_result: "ok", checked_at: "2026-11-12T10:00:00.000Z" }) }),
    );

    fireEvent.click(button("Check now"));

    await waitFor(() => expect(api.checkCustomDomain).toHaveBeenCalledWith("evt-1"));
    expect(await within(addressCard()).findByText(`${DOMAIN}: Working`)).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText("Link for guests") as HTMLInputElement).value).toBe(`https://${DOMAIN}/r/demo`));
  });

  it("tells what a failed check found, and what to ask IT", async () => {
    api.checkCustomDomain.mockResolvedValue(state({ custom_domain_status: "failing", custom_domain_check_result: "dns_failed", custom_domain_checked_at: "2026-11-12T10:00:00.000Z" }));
    await renderLoaded(settings({ own_address: own() }));
    api.fetchRegistrationSettings.mockResolvedValue(settings({ own_address: own({ status: "failing", check_result: "dns_failed", checked_at: "2026-11-12T10:00:00.000Z" }) }));

    fireEvent.click(button("Check now"));

    expect(await within(addressCard()).findByText(`${DOMAIN}: Not working yet`)).toBeTruthy();
    expect(within(addressCard()).getByText(/Ask IT to create a CNAME record that points it to admitto.example.com\./)).toBeTruthy();
  });

  it("is off, with the reason, while the field holds an address that is not saved", async () => {
    await renderLoaded(settings({ own_address: own() }));
    type("other.acme.example");

    expect(isOff(button("Check now"))).toBe(true);
    expect(getTooltipText(button("Check now"))).toBe("Save the address first. The check asks the address that is saved.");
  });

  it("says it could not check, and says too many when the limit is reached", async () => {
    api.checkCustomDomain.mockRejectedValueOnce(new ApiError(429, "domain_check_rate_limited", "domain_check_rate_limited"));
    await renderLoaded(settings({ own_address: own() }));

    fireEvent.click(button("Check now"));

    expect((await screen.findByRole("alert")).textContent).toBe("Too many checks right now. Wait a minute and try again.");
  });
});

describe("removing the address", () => {
  it("asks first, then removes it, says so, and goes back to a card with no address", async () => {
    api.saveCustomDomain.mockResolvedValue(state({ custom_domain: null }));
    await renderLoaded(settings({ own_address: own({ status: "ok", verified: true, check_result: "ok" }) }));
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
    await renderLoaded(settings({ own_address: own() }));

    fireEvent.click(button("Remove"));
    const dialog = await screen.findByRole("dialog", { name: "Remove the own address?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.saveCustomDomain).not.toHaveBeenCalled();
  });

  it("keeps the question open and says why when the removal fails", async () => {
    api.saveCustomDomain.mockRejectedValue(new ApiError(500, "internal_error", "internal_error"));
    await renderLoaded(settings({ own_address: own() }));

    fireEvent.click(button("Remove"));
    const dialog = await screen.findByRole("dialog", { name: "Remove the own address?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove address" }));

    await waitFor(() => expect(within(dialog).getByText(/Something went wrong/)).toBeTruthy());
    expect(screen.getByRole("dialog", { name: "Remove the own address?" })).toBeTruthy();
  });
});

describe("an archived event", () => {
  it("is read only: the buttons are off, with the reason", async () => {
    await renderLoaded(settings({ own_address: own() }), { withEvent: archivedEvent });

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
