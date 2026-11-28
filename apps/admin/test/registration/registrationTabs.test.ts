import { describe, expect, it } from "vitest";
import { REGISTRATION_TABS, registrationTabFromSearch, registrationTabItems, registrationTabPath } from "../../src/registration/registrationTabs.js";

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
    expect(registrationTabFromSearch(new URLSearchParams("tab=legal&tab=fields")).id).toBe("legal");
  });

  it("leaves the other parts of the address alone", () => {
    expect(registrationTabFromSearch(new URLSearchParams("state=pending&tab=fields")).id).toBe("fields");
  });
});

describe("registrationTabItems", () => {
  it("lists Requests, Fields, Legal and Checklist in that order, with no number while the counts are unknown", () => {
    const items = registrationTabItems();

    expect(items.map((item) => [item.id, item.label])).toEqual([
      ["requests", "Requests"],
      ["fields", "Fields"],
      ["legal", "Legal"],
      ["checklist", "Checklist"],
    ]);
    expect(items.every((item) => item.count === undefined)).toBe(true);
  });

  it("puts the count of requests on Requests and nowhere else", () => {
    expect(registrationTabItems(4).map((item) => item.count)).toEqual([4, undefined, undefined, undefined]);
  });

  it("names the count of requests for assistive tech, and has no number for none", () => {
    const requests = (waiting?: number) => registrationTabItems(waiting).find((item) => item.id === "requests");

    expect(requests(4)).toMatchObject({ count: 4, countLabel: "4 requests wait for a decision" });
    expect(requests(1)).toMatchObject({ count: 1, countLabel: "1 request waits for a decision" });
    expect(requests(0)?.count).toBeUndefined();
    expect(requests(0)?.countLabel).toBeUndefined();
    expect(requests()?.count).toBeUndefined();
  });

  it("puts the open steps on Checklist, named for assistive tech, and nothing on it when none is open or the number is unknown", () => {
    const checklist = (steps?: number) => registrationTabItems(undefined, steps).find((item) => item.id === "checklist");

    expect(checklist(3)).toMatchObject({ count: 3, countLabel: "3 steps open" });
    expect(checklist(1)).toMatchObject({ count: 1, countLabel: "1 step open" });
    expect(checklist(0)?.count).toBeUndefined();
    expect(checklist()?.count).toBeUndefined();
    expect(registrationTabItems(4, 2).map((item) => item.count)).toEqual([4, undefined, undefined, 2]);
  });

  it("puts Checklist after Legal, and the old Access tab is gone, with no alias", () => {
    expect(REGISTRATION_TABS.map((tab) => tab.id).slice(-2)).toEqual(["legal", "checklist"]);
    expect(registrationTabFromSearch(new URLSearchParams("tab=access")).id).toBe("requests");
    expect(registrationTabFromSearch(new URLSearchParams("tab=checklist")).id).toBe("checklist");
  });
});

describe("registrationTabPath", () => {
  it("is the address of a tab of the Registration page of an event, with the id made safe", () => {
    expect(registrationTabPath("evt-1", "checklist")).toBe("/admin/events/evt-1/registration?tab=checklist");
    expect(registrationTabPath("a/b", "fields")).toBe("/admin/events/a%2Fb/registration?tab=fields");
  });
});
