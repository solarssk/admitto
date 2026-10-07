// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { WizardProvider } from "../../src/pages/wizard/WizardContext.js";
import { WizardStep3Branding, type WizardStep3BrandingHandle } from "../../src/pages/wizard/WizardStep3Branding.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, deferred, hangUntilAborted, renderWithToast } from "../test-utils.js";

const { fetchOrgBranding, patchOrgBranding } = vi.hoisted(() => ({
  fetchOrgBranding: vi.fn(),
  patchOrgBranding: vi.fn(),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchOrgBranding: (...args: unknown[]) => fetchOrgBranding(...args),
  patchOrgBranding: (...args: unknown[]) => patchOrgBranding(...args),
}));

/** Shows what the step hands to the zone, so that the mapping of the answer can be asserted. */
vi.mock("../../src/components/LogoUploadZone.js", () => ({
  LogoUploadZone: (props: { value: string; originalUrl: string | null; cropMeta: unknown; committedValue: string | null; committedOriginalUrl: string | null }) => (
    <div data-testid="logo-zone">
      {JSON.stringify({
        value: props.value,
        originalUrl: props.originalUrl,
        cropMeta: props.cropMeta,
        committedValue: props.committedValue,
        committedOriginalUrl: props.committedOriginalUrl,
      })}
    </div>
  ),
}));

const crop = { unit: "%" as const, x: 5, y: 5, width: 90, height: 90, zoom: 1 };
const branding = {
  org_name: "Acme Events",
  logo_url: "https://cdn.example.com/logo.png",
  logo_original_url: "https://cdn.example.com/logo-original.png",
  logo_crop: crop,
};

/** Inside the body of a step, as it is in the wizard: the focus of a Retry that worked goes there. */
function renderStep(ref?: React.Ref<WizardStep3BrandingHandle>, onDirtyChange?: (dirty: boolean) => void) {
  return renderWithToast(
    <div className="setup-wizard__body">
      <WizardProvider>
        <WizardStep3Branding ref={ref} onDirtyChange={onDirtyChange} />
      </WizardProvider>
    </div>,
  );
}

const placeholder = () => screen.queryByRole("status", { name: "Loading branding" });
const nameField = () => screen.getByLabelText("Organisation name") as HTMLInputElement;

beforeEach(() => {
  vi.useFakeTimers();
  fetchOrgBranding.mockReset();
  patchOrgBranding.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("WizardStep3Branding: the first read", () => {
  it("holds the form's room invisibly for 200ms, then draws a placeholder of its shape, and says it is taking longer after 8 seconds", async () => {
    fetchOrgBranding.mockImplementation(hangUntilAborted as never);
    renderStep();
    await advanceTimers(0);

    expect((placeholder() as HTMLElement).classList.contains("at-loading-hold")).toBe(true);
    expect(screen.queryByText("Loading branding…")).toBeNull();
    await advanceTimers(200);
    expect((placeholder() as HTMLElement).classList.contains("at-loading-hold")).toBe(false);
    await advanceTimers(7_799);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advanceTimers(1);
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("never draws the placeholder for an answer within 200ms, and fills the form with what was stored", async () => {
    fetchOrgBranding.mockResolvedValueOnce(branding);
    renderStep();
    await advanceTimers(0);

    expect(placeholder()).toBeNull();
    expect(nameField().value).toBe("Acme Events");
    expect(JSON.parse(screen.getByTestId("logo-zone").textContent ?? "")).toEqual({
      value: "https://cdn.example.com/logo.png",
      originalUrl: "https://cdn.example.com/logo-original.png",
      cropMeta: crop,
      committedValue: "https://cdn.example.com/logo.png",
      committedOriginalUrl: "https://cdn.example.com/logo-original.png",
    });
  });

  it("fills an empty form when nothing is stored yet", async () => {
    fetchOrgBranding.mockResolvedValueOnce({ org_name: null, logo_url: null, logo_original_url: null, logo_crop: null });
    renderStep();
    await advanceTimers(0);

    expect(nameField().value).toBe("");
    expect(JSON.parse(screen.getByTestId("logo-zone").textContent ?? "")).toEqual({
      value: "",
      originalUrl: null,
      cropMeta: null,
      committedValue: null,
      committedOriginalUrl: null,
    });
  });

  it("says the branding could not be loaded, with no toast and no empty form that a save would overwrite what is stored with", async () => {
    fetchOrgBranding.mockRejectedValueOnce(new ApiError(500, "boom"));
    renderStep();
    await advanceTimers(0);

    expect(screen.getByRole("alert").textContent).toContain("Could not load branding");
    expect(screen.queryByLabelText("Organisation name")).toBeNull();
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("says it could not load the branding when the read fails with nothing to say for itself", async () => {
    fetchOrgBranding.mockRejectedValueOnce(new Error("socket hang up"));
    renderStep();
    await advanceTimers(0);

    expect(screen.getByRole("alert").textContent).toContain("Could not load branding.");
    expect(screen.queryByText(/socket hang up/)).toBeNull();
  });

  it("ends in an error after 30 seconds, with a Retry that stays on screen, busy, with its focus, and hands the focus to the step's body when it works", async () => {
    fetchOrgBranding.mockImplementationOnce(hangUntilAborted as never);
    renderStep();
    await advanceTimers(0);
    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);

    const answer = deferred<typeof branding>();
    fetchOrgBranding.mockReturnValueOnce(answer.promise);
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(500);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);

    await act(async () => answer.resolve(branding));
    await advanceTimers(500);
    expect(nameField().value).toBe("Acme Events");
    expect(document.activeElement).toBe(document.querySelector(".setup-wizard__body"));
  });
});

describe("WizardStep3Branding: saving", () => {
  it("saves nothing before the read has answered, without a message, and tells the step to stay", async () => {
    fetchOrgBranding.mockImplementation(hangUntilAborted as never);
    const ref = createRef<WizardStep3BrandingHandle>();
    renderStep(ref);
    await advanceTimers(0);

    let saved = true;
    await act(async () => {
      saved = await ref.current!.saveAndContinue();
    });
    expect(saved).toBe(false);
    expect(patchOrgBranding).not.toHaveBeenCalled();
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("saves the trimmed name and the logo once the form is there, and clears the step's unsaved mark", async () => {
    fetchOrgBranding.mockResolvedValueOnce(branding);
    patchOrgBranding.mockResolvedValueOnce({ ...branding, org_name: "New Name" });
    const ref = createRef<WizardStep3BrandingHandle>();
    const onDirtyChange = vi.fn();
    renderStep(ref, onDirtyChange);
    await advanceTimers(0);

    fireEvent.change(nameField(), { target: { value: "  New Name  " } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    let saved = false;
    await act(async () => {
      saved = await ref.current!.saveAndContinue();
    });

    expect(saved).toBe(true);
    expect(patchOrgBranding).toHaveBeenCalledWith({
      org_name: "New Name",
      logo_url: "https://cdn.example.com/logo.png",
      logo_original_url: "https://cdn.example.com/logo-original.png",
      logo_crop: crop,
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("asks for a name, and says why a save failed", async () => {
    fetchOrgBranding.mockResolvedValueOnce({ ...branding, org_name: "" });
    const ref = createRef<WizardStep3BrandingHandle>();
    renderStep(ref);
    await advanceTimers(0);

    let saved = true;
    await act(async () => {
      saved = await ref.current!.saveAndContinue();
    });
    expect(saved).toBe(false);
    expect(screen.getByText("Organisation name is required.")).toBeTruthy();
    expect(patchOrgBranding).not.toHaveBeenCalled();

    patchOrgBranding.mockRejectedValueOnce(new ApiError(500, "boom"));
    fireEvent.change(nameField(), { target: { value: "Acme" } });
    await act(async () => {
      saved = await ref.current!.saveAndContinue();
    });
    expect(saved).toBe(false);
    expect(screen.getAllByTestId("at-toast").length).toBeGreaterThan(0);
  });
});
