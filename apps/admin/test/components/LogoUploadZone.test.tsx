// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogoUploadZone } from "../../src/components/LogoUploadZone.js";

afterEach(cleanup);

describe("LogoUploadZone", () => {
  it("shows drop zone when value is empty", () => {
    render(<LogoUploadZone value="" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /drop logo here/i })).toBeTruthy();
  });

  it("shows preview and clear button for uploaded path", () => {
    render(
      <LogoUploadZone value="/uploads/default/abc.png" onChange={() => {}} />,
    );
    expect(screen.getByAltText("Organisation logo preview")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove logo" })).toBeTruthy();
    expect(screen.queryByText(/drop logo here/i)).toBeNull();
  });

  it("calls onChange with empty string when clear is clicked", () => {
    const onChange = vi.fn();
    render(<LogoUploadZone value="/uploads/default/abc.png" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
