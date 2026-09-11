import { describe, expect, it } from "vitest";
import {
  searchableSelectPanelClassName,
  searchableSelectTriggerClassName,
} from "../../src/components/searchable-select-class-names.js";

describe("searchableSelectTriggerClassName", () => {
  it("is the bare trigger class with none of the modifiers active", () => {
    expect(searchableSelectTriggerClassName(false, false, false)).toBe("searchable-select__trigger");
    expect(searchableSelectTriggerClassName(undefined, false, false)).toBe("searchable-select__trigger");
  });

  it("adds --invalid when invalid, regardless of panelMode/open", () => {
    expect(searchableSelectTriggerClassName(true, false, false)).toBe(
      "searchable-select__trigger searchable-select__trigger--invalid",
    );
  });

  it("adds --open only when inline AND open - never for floating mode", () => {
    expect(searchableSelectTriggerClassName(false, true, true)).toBe(
      "searchable-select__trigger searchable-select__trigger--open",
    );
    expect(searchableSelectTriggerClassName(false, false, true)).toBe("searchable-select__trigger");
    expect(searchableSelectTriggerClassName(false, true, false)).toBe("searchable-select__trigger");
  });

  it("combines both modifiers", () => {
    expect(searchableSelectTriggerClassName(true, true, true)).toBe(
      "searchable-select__trigger searchable-select__trigger--invalid searchable-select__trigger--open",
    );
  });
});

describe("searchableSelectPanelClassName", () => {
  it("is the inline variant regardless of openUpward, once isInline is true", () => {
    expect(searchableSelectPanelClassName(true, false)).toBe(
      "searchable-select__panel searchable-select__panel--inline",
    );
    expect(searchableSelectPanelClassName(true, true)).toBe(
      "searchable-select__panel searchable-select__panel--inline",
    );
  });

  it("adds --up only in floating mode when the panel flips upward", () => {
    expect(searchableSelectPanelClassName(false, true)).toBe(
      "searchable-select__panel searchable-select__panel--up",
    );
    expect(searchableSelectPanelClassName(false, false)).toBe("searchable-select__panel");
  });
});
