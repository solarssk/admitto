import { describe, expect, it } from "vitest";
import { REGISTRATION_TABS, registrationTabFromSearch, registrationTabItems } from "../../src/registration/registrationTabs.js";

describe("registrationTabFromSearch", () => {
  it.each(REGISTRATION_TABS.map((tab) => tab.id))("opens %s when the address names it", (id) => {
    expect(registrationTabFromSearch(new URLSearchParams({ tab: id })).id).toBe(id);
  });

  it.each([
    ["no tab", ""],
    ["an empty tab", "tab="],
    ["an unknown tab", "tab=settings"],
  ])("opens Requests for %s", (_case, search) => {
    expect(registrationTabFromSearch(new URLSearchParams(search)).id).toBe("requests");
  });

  it("reads the first tab when the address repeats it", () => {
    expect(registrationTabFromSearch(new URLSearchParams("tab=access&tab=fields")).id).toBe("access");
  });

  it("leaves the other parts of the address alone", () => {
    expect(registrationTabFromSearch(new URLSearchParams("state=pending&tab=fields")).id).toBe("fields");
  });
});

describe("registrationTabItems", () => {
  it("lists Requests, Fields, Access and Legal in that order, with no number while the count is unknown", () => {
    const items = registrationTabItems();

    expect(items.map((item) => [item.id, item.label])).toEqual([
      ["requests", "Requests"],
      ["fields", "Fields"],
      ["access", "Access"],
      ["legal", "Legal"],
    ]);
    expect(items.every((item) => item.count === undefined)).toBe(true);
  });

  it("puts the count on Requests and nowhere else", () => {
    expect(registrationTabItems(4).map((item) => item.count)).toEqual([4, undefined, undefined, undefined]);
  });
});
