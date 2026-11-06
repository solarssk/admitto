// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationSettingsDto } from "../../src/api/types.js";
import { isOff } from "../test-utils.js";
import { api } from "./accessApiMocks.js";
import { archivedEvent, settings, ssoChecks } from "./accessData.js";
import { card, radio, renderLoaded, resetApi, saveButton, toggle } from "./accessFixtures.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    saveRegistrationSettings: (...args: unknown[]) => mocks.saveRegistrationSettings(...args),
    setRegistrationPassword: (...args: unknown[]) => mocks.setRegistrationPassword(...args),
    clearRegistrationPassword: (...args: unknown[]) => mocks.clearRegistrationPassword(...args),
    fetchLegalDocuments: (...args: unknown[]) => mocks.fetchLegalDocuments(...args),
    fetchRegistrationCounts: (...args: unknown[]) => mocks.fetchRegistrationCounts(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: vi.fn() }));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

const ssoSettings = (overrides: Partial<RegistrationSettingsDto> = {}) => settings({ access_methods: ["sso"], readiness: ssoChecks(), ...overrides });
const claimName = () => screen.queryByLabelText("Claim name") as HTMLInputElement | null;
const claimValues = () => screen.queryByLabelText("Allowed values") as HTMLTextAreaElement | null;
const type = (control: HTMLElement | null, value: string) => fireEvent.change(control as HTMLElement, { target: { value } });
const alertText = () => screen.getByRole("alert").textContent ?? "";

async function save() {
  fireEvent.click(saveButton());
  await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalled());
}

beforeEach(() => {
  resetApi();
});

afterEach(() => {
  cleanup();
});

describe("the company sign-in as the way in of an event", () => {
  it("is a third way in beside the link and the password, and says what it does", async () => {
    await renderLoaded(ssoSettings());

    expect(radio("Company sign-in").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Guests sign in with the company's identity provider to open the form\. The email address comes from that sign-in and cannot be changed on the form\./)).toBeTruthy();
    expect(screen.queryByText("Event password")).toBeNull();
    expect(screen.queryByText("Choosing another way in later removes the password.")).toBeNull();
  });

  it("greys out the confirmation of the address for the company sign-in and says why, and gives the switch back, unchanged, with the other ways in", async () => {
    await renderLoaded(settings({ verify_email: true }));
    expect(isOff(toggle("Confirm email addresses"))).toBe(false);

    fireEvent.click(radio("Company sign-in"));

    expect(isOff(toggle("Confirm email addresses"))).toBe(true);
    expect(screen.getByText(/Not used with the company sign-in: the identity provider has already verified the address, so guests are sent no confirmation link\./)).toBeTruthy();
    expect(screen.queryByText(/Guests confirm their address with a link/)).toBeNull();
    fireEvent.click(radio("Link"));
    expect(isOff(toggle("Confirm email addresses"))).toBe(false);
    expect(toggle("Confirm email addresses").checked).toBe(true);
    expect(screen.getByText(/Guests confirm their address with a link/)).toBeTruthy();
  });

  it("does not send the confirmation of the address when the way in is the company sign-in, though it is on", async () => {
    await renderLoaded(settings({ verify_email: true }));
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings({ verify_email: true }));

    fireEvent.click(radio("Company sign-in"));
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["sso"] });
  });

  it("shows the fields of the restriction for the company sign-in only", async () => {
    await renderLoaded(settings());
    expect(claimName()).toBeNull();
    expect(claimValues()).toBeNull();

    fireEvent.click(radio("Company sign-in"));
    expect(claimName()).toBeTruthy();
    expect(claimValues()).toBeTruthy();

    fireEvent.click(radio("Password"));
    expect(claimName()).toBeNull();
    fireEvent.click(radio("Link"));
    expect(claimName()).toBeNull();
    expect(claimValues()).toBeNull();
  });

  it("explains the restriction: the claim and its values, tid and the tenant ID of Microsoft Entra ID, exact matching, never an address, and empty for none", async () => {
    await renderLoaded(ssoSettings());
    const text = card("Way in").textContent ?? "";

    expect(text).toMatch(/With Microsoft Entra ID, the claim is usually tid and the value is the tenant ID of the company \(a GUID\)\./);
    expect(text).toMatch(/Leave both empty for no restriction\./);
    expect(text).toMatch(/must match exactly, with capital letters as they are\./);
    expect(text).toMatch(/Never use the end of an email address here/);
    expect(text).toMatch(/A change counts at once, also for guests who have already signed in\./);
    expect(text).not.toMatch(/[–—]/);
  });

  it("shows the restriction that is saved, the name and one value on each line", async () => {
    await renderLoaded(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111", "bbb-222"] }));

    expect(claimName()?.value).toBe("tid");
    expect(claimValues()?.value).toBe("aaa-111\nbbb-222");
    expect(isOff(saveButton())).toBe(true);
  });

  it("sends the way in with the name and the values in one save", async () => {
    await renderLoaded(settings());
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111", "bbb-222"] }));

    fireEvent.click(radio("Company sign-in"));
    type(claimName(), "tid");
    type(claimValues(), "aaa-111\n\nbbb-222\n");
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", {
      access_methods: ["sso"],
      sso_claim_name: "tid",
      sso_claim_values: ["aaa-111", "bbb-222"],
    });
    await waitFor(() => expect(claimValues()?.value).toBe("aaa-111\nbbb-222"));
    expect(isOff(saveButton())).toBe(true);
  });

  it("sends the name too when only the values changed, since the server takes the two together", async () => {
    await renderLoaded(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111", "ccc-333"] }));

    type(claimValues(), "aaa-111\nccc-333");
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_claim_name: "tid", sso_claim_values: ["aaa-111", "ccc-333"] });
  });

  it("takes the restriction away with null and an empty list when both fields are cleared", async () => {
    await renderLoaded(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings());

    type(claimName(), "");
    type(claimValues(), "");
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_claim_name: null, sso_claim_values: [] });
    await waitFor(() => expect(claimName()?.value).toBe(""));
  });

  it("does not count spaces or an empty line as a change", async () => {
    await renderLoaded(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));

    type(claimName(), " tid ");
    type(claimValues(), "\naaa-111 \n\n");

    expect(isOff(saveButton())).toBe(true);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("sends only the way in when the event moves away from the company sign-in, whatever is typed", async () => {
    await renderLoaded(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));
    api.saveRegistrationSettings.mockResolvedValue(settings());

    fireEvent.click(radio("Link"));
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["link"] });
  });

  it("takes the typed restriction back with Reset", async () => {
    await renderLoaded(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));

    type(claimName(), "oid");
    type(claimValues(), "zzz");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(claimName()?.value).toBe("tid");
    expect(claimValues()?.value).toBe("aaa-111");
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("locks the fields of the restriction for an archived event", async () => {
    await renderLoaded(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }), { withEvent: archivedEvent });

    expect(claimName()?.disabled).toBe(true);
    expect(claimValues()?.disabled).toBe(true);
  });
});

describe("what is wrong with the restriction", () => {
  it("names the missing value when only the name is typed, in the field and in the box beside the buttons, and sends nothing", async () => {
    await renderLoaded(ssoSettings());

    type(claimName(), "tid");
    fireEvent.click(saveButton());

    expect(screen.getByText("Enter at least one value, or clear the name.")).toBeTruthy();
    expect(claimValues()?.getAttribute("aria-invalid")).toBe("true");
    expect(alertText()).toBe("Fix the restriction of the company sign-in before you save.");
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("lets registration be turned off with a restriction that is not complete, and leaves the restriction out of that save", async () => {
    await renderLoaded(ssoSettings({ mode: "automatic" }));
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings({ mode: null }));
    type(claimName(), "tid");

    fireEvent.click(radio("Off"));
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole("dialog", { name: "Turn off registration?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off registration" }));

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode: null }));
    // The form shows what is saved afterwards: no restriction.
    await waitFor(() => expect(claimName()?.value).toBe(""));
  });

  it("still sends a restriction that is complete along with turning registration off", async () => {
    await renderLoaded(ssoSettings({ mode: "automatic" }));
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings({ mode: null, sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));
    type(claimName(), "tid");
    type(claimValues(), "aaa-111");

    fireEvent.click(radio("Off"));
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole("dialog", { name: "Turn off registration?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off registration" }));

    await waitFor(() =>
      expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode: null, sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }),
    );
  });

  it("still stops a save that keeps registration on at a restriction that is not complete", async () => {
    await renderLoaded(ssoSettings({ mode: "automatic" }));
    type(claimName(), "tid");

    fireEvent.click(radio("With approval"));
    fireEvent.click(saveButton());

    expect(alertText()).toBe("Fix the restriction of the company sign-in before you save.");
    expect(screen.queryByRole("dialog", { name: "Turn off registration?" })).toBeNull();
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("names the missing claim when only values are typed", async () => {
    await renderLoaded(ssoSettings());

    type(claimValues(), "aaa-111");
    fireEvent.click(saveButton());

    expect(screen.getByText("Enter the name of the claim these values belong to.")).toBeTruthy();
    expect(claimName()?.getAttribute("aria-invalid")).toBe("true");
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("refuses a name with a space and says what a name may hold", async () => {
    await renderLoaded(ssoSettings());

    type(claimName(), "my claim");
    type(claimValues(), "aaa-111");

    expect(screen.getByText("The name has letters, digits and signs only, with no spaces.")).toBeTruthy();
  });

  it("refuses more values than the server takes, and values that are too long", async () => {
    await renderLoaded(ssoSettings());
    type(claimName(), "tid");

    type(claimValues(), Array.from({ length: 21 }, (_, index) => `v${index}`).join("\n"));
    expect(screen.getByText("List at most 20 values.")).toBeTruthy();

    type(claimValues(), "v".repeat(129));
    expect(screen.getByText("A value can have at most 128 characters.")).toBeTruthy();
  });

  it("clears the notice beside the buttons when the person edits, and the error of a field when it is put right", async () => {
    await renderLoaded(ssoSettings());
    type(claimName(), "tid");
    fireEvent.click(saveButton());
    expect(screen.getByRole("alert")).toBeTruthy();

    type(claimValues(), "aaa-111");

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Enter at least one value, or clear the name.")).toBeNull();
    expect(claimValues()?.getAttribute("aria-invalid")).toBeNull();
  });

  it("does not call a restriction typed under another way in an error", async () => {
    await renderLoaded(ssoSettings());
    type(claimName(), "my claim");

    fireEvent.click(radio("Link"));

    expect(screen.queryByText("The name has letters, digits and signs only, with no spaces.")).toBeNull();
  });

  it("says in its own words when the server refuses a restriction for a way in that is not the company sign-in", async () => {
    await renderLoaded(ssoSettings());
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(422, "sso_claim_needs_sso", "sso_claim_needs_sso"));

    type(claimName(), "tid");
    type(claimValues(), "aaa-111");
    await save();

    await waitFor(() => expect(alertText()).toContain("The restriction to one company works with the company sign-in only."));
    expect(alertText()).not.toContain("sso_claim_needs_sso");
  });
});

describe("the setup checklist of an event with the company sign-in", () => {
  const rows = () => Array.from(card("Setup checklist").querySelectorAll("li.access-check"));

  it("has no bot protection among its checks, and the company sign-in as one", async () => {
    await renderLoaded(ssoSettings());

    expect(screen.queryByText("Bot protection")).toBeNull();
    expect(within(card("Setup checklist")).getByText("Company sign-in")).toBeTruthy();
    expect(rows()).toHaveLength(10);
  });

  it("says that the form stays closed and who sets it up, with where, when the identity provider is not chosen", async () => {
    await renderLoaded(ssoSettings({ readiness: ssoChecks("identity_provider") }));

    const row = rows()[0] as HTMLElement;
    expect(row.textContent).toContain("The company sign-in is not set up, so the form stays closed.");
    expect(row.textContent).toContain("Ask a superadmin to choose the identity provider in Organisation settings, External services, Ways in.");
  });
});

describe("the restriction fields, for a screen reader", () => {
  async function violations(): Promise<string[]> {
    // The colours are drawn by the stylesheet that jsdom does not load, so contrast is left to the check in a real browser.
    const result = await axe.run(card("Way in"), { rules: { "color-contrast": { enabled: false } } });
    return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
  }

  it("has no violation with the fields empty, filled in or in error", async () => {
    await renderLoaded(ssoSettings());
    expect(await violations()).toEqual([]);

    type(claimName(), "tid");
    type(claimValues(), "aaa-111");
    expect(await violations()).toEqual([]);

    type(claimValues(), "");
    expect(await violations()).toEqual([]);
  });

  it("gives each field a name and ties the error to the box that it is about", async () => {
    await renderLoaded(ssoSettings());
    type(claimName(), "tid");

    const values = claimValues() as HTMLTextAreaElement;
    expect(claimName()?.id).toBeTruthy();
    expect(document.getElementById(values.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Enter at least one value, or clear the name.");
  });
});
