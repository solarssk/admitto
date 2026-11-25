// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyField } from "../../src/components/CopyField.js";
import { renderWithToast } from "../test-utils.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

const box = () => screen.getByLabelText("Return address") as HTMLInputElement;
const copyButton = () => screen.getByRole("button", { name: "Copy the return address" }) as HTMLButtonElement;

describe("CopyField", () => {
  it("is a box that is read only and not disabled, so that its text can be selected by hand, with the button that copies it on the left", () => {
    renderWithToast(<CopyField label="Return address" value="https://admitto.example.com/sso/callback" copyLabel="Copy the return address" />);

    expect(box().value).toBe("https://admitto.example.com/sso/callback");
    expect(box().readOnly).toBe(true);
    expect(box().disabled).toBe(false);
    expect(box().classList.contains("copy-field__input")).toBe(true);
    const group = box().closest(".at-inputgroup") as HTMLElement;
    expect(group.firstElementChild).toBe(copyButton());
    expect(copyButton().disabled).toBe(false);
  });

  it("copies the value and says so in a short toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    renderWithToast(<CopyField label="Return address" value="https://admitto.example.com/sso/callback" copyLabel="Copy the return address" />);

    fireEvent.click(copyButton());

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://admitto.example.com/sso/callback"));
    expect(await screen.findByText("Copied.")).toBeTruthy();
  });

  it("says that the copy failed, and that the text can be selected by hand", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    renderWithToast(<CopyField label="Return address" value="https://admitto.example.com/sso/callback" copyLabel="Copy the return address" />);

    fireEvent.click(copyButton());

    expect(await screen.findByText("Could not copy. Select the text and copy it by hand.")).toBeTruthy();
  });

  it("has the button off while there is no value, and shows the grey example instead", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    renderWithToast(<CopyField label="Return address" value="" placeholder="https://events.example.com/callback" copyLabel="Copy the return address" />);

    expect(copyButton().disabled).toBe(true);
    expect(box().placeholder).toBe("https://events.example.com/callback");
    fireEvent.click(copyButton());
    expect(writeText).not.toHaveBeenCalled();
  });

  it("describes the box by its hint when it has one, and by nothing when it has none", () => {
    renderWithToast(<CopyField label="Return address" value="x" copyLabel="Copy the return address" hint="Enter this address at the identity provider." />);
    const hint = screen.getByText("Enter this address at the identity provider.");
    expect(hint.classList.contains("at-hint")).toBe(true);
    expect(box().getAttribute("aria-describedby")).toBe(hint.id);
    cleanup();

    renderWithToast(<CopyField label="Return address" value="x" copyLabel="Copy the return address" />);
    expect(box().hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("CopyField: CSS that the tests in jsdom cannot see", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/components/copy-field.css"), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");

  it("is grey and in a fixed-width font, with no height of its own", () => {
    const input = css.match(/\.at-input\.copy-field__input \{([^}]*)\}/)?.[1] ?? "";
    expect(input).toMatch(/font-family: var\(--font-mono\);/);
    expect(input).toMatch(/background-color: var\(--at-gray-100\);/);
    expect(input).not.toMatch(/height/);
  });

  it("has a grey frame that is as high as every other field wherever the box stands, with the input inside that height", () => {
    const group = css.match(/\.at-inputgroup:has\(\.at-input\.copy-field__input\) \{([^}]*)\}/)?.[1] ?? "";
    expect(group).toMatch(/background: var\(--at-gray-100\);/);
    expect(group).toMatch(/box-sizing: border-box;/);
    expect(group).toMatch(/height: var\(--control-h\);/);
    expect(css).toMatch(/\.at-inputgroup:has\(\.at-input\.copy-field__input\) \.at-input \{\s*height: 100%;/);
  });
});
