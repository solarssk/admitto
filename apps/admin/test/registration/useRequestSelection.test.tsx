// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RegistrationListItemDto } from "../../src/api/types.js";
import { useRequestSelection } from "../../src/registration/useRequestSelection.js";
import { request } from "./requestsData.js";

const page = (...ids: string[]): RegistrationListItemDto[] => ids.map((id) => request(id));
const idsOf = (rows: RegistrationListItemDto[]) => rows.map((row) => row.id);

function mount(initial: RegistrationListItemDto[], key = "page-1") {
  return renderHook(({ items, resetKey }) => useRequestSelection(items, resetKey), { initialProps: { items: initial, resetKey: key } });
}

describe("the selection of a page", () => {
  it("is empty at first, and holds what is ticked in the order of the page, whichever was ticked first", () => {
    const { result } = mount(page("a", "b", "c"));
    expect(result.current.rows).toEqual([]);
    expect(result.current.allSelected).toBe(false);

    act(() => result.current.toggle("c"));
    act(() => result.current.toggle("a"));

    expect(idsOf(result.current.rows)).toEqual(["a", "c"]);
    expect(result.current.isSelected("a")).toBe(true);
    expect(result.current.isSelected("b")).toBe(false);
  });

  it("unticks what is ticked again", () => {
    const { result } = mount(page("a", "b"));

    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("a"));

    expect(result.current.rows).toEqual([]);
  });

  it("selects the whole page, and is all selected only then; again, it takes everything away", () => {
    const { result } = mount(page("a", "b", "c"));
    act(() => result.current.toggle("a"));
    expect(result.current.allSelected).toBe(false);

    act(() => result.current.toggleAll());
    expect(idsOf(result.current.rows)).toEqual(["a", "b", "c"]);
    expect(result.current.allSelected).toBe(true);

    act(() => result.current.toggleAll());
    expect(result.current.rows).toEqual([]);
    expect(result.current.allSelected).toBe(false);
  });

  it("is never all selected on a page with no requests", () => {
    const { result } = mount([]);

    expect(result.current.allSelected).toBe(false);
    act(() => result.current.toggleAll());
    expect(result.current.rows).toEqual([]);
  });

  it("lets go of a request that leaves the page, and does not take it back when it comes again", () => {
    const { result, rerender } = mount(page("a", "b", "c"));
    act(() => result.current.toggleAll());

    rerender({ items: page("b", "c"), resetKey: "page-1" });
    expect(idsOf(result.current.rows)).toEqual(["b", "c"]);

    rerender({ items: page("a", "b", "c"), resetKey: "page-1" });
    expect(idsOf(result.current.rows)).toEqual(["b", "c"]);
    expect(result.current.isSelected("a")).toBe(false);
  });

  it("keeps the same selection when the page is read again and has the same requests, not a new one", () => {
    const { result, rerender } = mount(page("a", "b"));
    act(() => result.current.toggle("a"));
    const before = result.current.rows;

    rerender({ items: page("a", "b"), resetKey: "page-1" });

    expect(idsOf(result.current.rows)).toEqual(["a"]);
    expect(before).toHaveLength(1);
  });

  it("starts empty for another page, state, search or page size, in the render that sees it", () => {
    const { result, rerender } = mount(page("a", "b"));
    act(() => result.current.toggleAll());

    rerender({ items: page("a", "b"), resetKey: "page-2" });

    expect(result.current.rows).toEqual([]);
    expect(result.current.isSelected("a")).toBe(false);
  });

  it("drops only the requests it is told to, and leaves the others ticked", () => {
    const { result } = mount(page("a", "b", "c"));
    act(() => result.current.toggleAll());

    act(() => result.current.drop(new Set(["a", "c", "not-here"])));

    expect(idsOf(result.current.rows)).toEqual(["b"]);
  });

  it("clears everything", () => {
    const { result } = mount(page("a", "b"));
    act(() => result.current.toggleAll());

    act(() => result.current.clear());

    expect(result.current.rows).toEqual([]);
  });
});
