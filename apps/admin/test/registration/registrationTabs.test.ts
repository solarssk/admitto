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
  it("lists Requests, Fields, Access, Legal and Checklist in that order, with no number while the counts are unknown", () => {
    const items = registrationTabItems();

    expect(items.map((item) => [item.id, item.label])).toEqual([
      ["requests", "Requests"],
      ["fields", "Fields"],
      ["access", "Access"],
      ["legal", "Legal"],
      ["checklist", "Checklist"],
    ]);
    expect(items.every((item) => item.count === undefined)).toBe(true);
  });

  it("puts the count of requests on Requests and nowhere else", () => {
    expect(registrationTabItems(4).map((item) => item.count)).toEqual([4, undefined, undefined, undefined, undefined]);
  });

  it("puts the open steps on Checklist, named for assistive tech, and nothing on it when none is open or the number is unknown", () => {
    const checklist = (steps?: number) => registrationTabItems(undefined, steps).find((item) => item.id === "checklist");

    expect(checklist(3)).toMatchObject({ count: 3, countLabel: "3 steps open" });
    expect(checklist(1)).toMatchObject({ count: 1, countLabel: "1 step open" });
    expect(checklist(0)?.count).toBeUndefined();
    expect(checklist()?.count).toBeUndefined();
    expect(registrationTabItems(4, 2).map((item) => item.count)).toEqual([4, undefined, undefined, undefined, 2]);
  });

  it("puts Checklist after Legal, and the old addresses keep their tabs", () => {
    expect(REGISTRATION_TABS.map((tab) => tab.id).slice(-2)).toEqual(["legal", "checklist"]);
    expect(registrationTabFromSearch(new URLSearchParams("tab=access")).id).toBe("access");
    expect(registrationTabFromSearch(new URLSearchParams("tab=checklist")).id).toBe("checklist");
  });
});
