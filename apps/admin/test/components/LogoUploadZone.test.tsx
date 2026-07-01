// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { LogoUploadZone } from "../../src/components/LogoUploadZone.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    uploadFile: vi.fn(),
  };
});

import { uploadFile } from "../../src/api/client.js";

const mockUploadFile = vi.mocked(uploadFile);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LogoUploadZone", () => {
  it("shows drop zone when value is empty", () => {
    render(<LogoUploadZone value="" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /drop logo here/i })).toBeTruthy();
  });

  it("shows preview and clear button for uploaded path", () => {
    render(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        onChange={() => {}}
      />,
    );
    expect(screen.getByAltText("Organisation logo preview")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove logo" })).toBeTruthy();
    expect(screen.queryByText(/drop logo here/i)).toBeNull();
  });

  it("does not preview invalid upload paths or URLs", () => {
    render(<LogoUploadZone value="/uploads/default/../evil.png" onChange={() => {}} />);
    expect(screen.queryByAltText("Organisation logo preview")).toBeNull();
  });

  it("calls onChange with empty string when clear is clicked", () => {
    const onChange = vi.fn();
    render(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("shows upload error when uploadFile fails", async () => {
    mockUploadFile.mockRejectedValue(new ApiError(415, "unsupported_file_type"));
    render(<LogoUploadZone value="" onChange={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "bad.exe", { type: "application/octet-stream" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("unsupported_file_type");
    });
  });

  it("clears value and shows alert when preview image fails to load", () => {
    const onChange = vi.fn();
    render(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        onChange={onChange}
      />,
    );
    const img = screen.getByAltText("Organisation logo preview");
    fireEvent.error(img);
    expect(onChange).toHaveBeenCalledWith("");
    expect(screen.getByRole("alert").textContent).toContain("corrupt");
  });

  it("rejects files over 2 MB before upload", async () => {
    render(<LogoUploadZone value="" onChange={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", {
      type: "image/png",
    });
    fireEvent.change(input, { target: { files: [big] } });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("2 MB");
    });
    expect(mockUploadFile).not.toHaveBeenCalled();
  });
});
