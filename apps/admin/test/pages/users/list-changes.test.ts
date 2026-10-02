import { describe, expect, it } from "vitest";
import type { RoleAssignmentListItemDto, SessionListDto, SessionsResponse, UserListItemDto, UserStatsDto } from "../../../src/api/types.js";
import {
  isPastTheEnd,
  matchesStaffQuery,
  rolesAfterStagedChanges,
  withAssignmentRemoved,
  withRoleRemoved,
  withSessionLabel,
  withSessionRemoved,
  withUserRemoved,
  withUserReplaced,
  type RoleAssignmentsAnswer,
  type StaffQuery,
  type StaffUsersAnswer,
} from "../../../src/pages/users/list-changes.js";
import { makeStaffUser } from "../../test-utils.js";

const stats = { total: 2 } as UserStatsDto;
const NO_FILTERS: StaffQuery = { search: "", role: "all", status: "all" };
const staff = (users: UserListItemDto[], query: StaffQuery = NO_FILTERS): StaffUsersAnswer => ({
  users,
  total: users.length,
  stats,
  query,
  filtersActive: query !== NO_FILTERS,
  pastTheEnd: false,
});
const assignment = (id: string) => ({ id } as RoleAssignmentListItemDto);
const roles = (...ids: string[]): UserListItemDto["roles"] => ids.map((id) => ({ id, role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false }));

describe("isPastTheEnd", () => {
  it("is true only for a page after the first that has no rows although there are some", () => {
    expect(isPastTheEnd(0, 25, 2)).toBe(true);
    expect(isPastTheEnd(0, 25, 1)).toBe(false);
    expect(isPastTheEnd(0, 0, 2)).toBe(false);
    expect(isPastTheEnd(3, 25, 2)).toBe(false);
  });
});

describe("matchesStaffQuery", () => {
  const person = { ...makeStaffUser("u1", "Jane Doe"), roles: roles("r1") };

  it("matches everyone when nothing narrows the list", () => {
    expect(matchesStaffQuery(person, NO_FILTERS)).toBe(true);
  });

  it("follows the status filter", () => {
    expect(matchesStaffQuery(person, { ...NO_FILTERS, status: "active" })).toBe(true);
    expect(matchesStaffQuery(person, { ...NO_FILTERS, status: "disabled" })).toBe(false);
    expect(matchesStaffQuery({ ...person, is_active: false }, { ...NO_FILTERS, status: "disabled" })).toBe(true);
    expect(matchesStaffQuery({ ...person, is_active: false }, { ...NO_FILTERS, status: "active" })).toBe(false);
  });

  it("follows the role filter: the person must hold a role of that kind", () => {
    expect(matchesStaffQuery(person, { ...NO_FILTERS, role: "operator" })).toBe(true);
    expect(matchesStaffQuery(person, { ...NO_FILTERS, role: "admin" })).toBe(false);
    expect(matchesStaffQuery({ ...person, roles: [] }, { ...NO_FILTERS, role: "operator" })).toBe(false);
  });

  it("follows the search, in the email or the name, whatever the case", () => {
    expect(matchesStaffQuery(person, { ...NO_FILTERS, search: "JANE" })).toBe(true);
    expect(matchesStaffQuery(person, { ...NO_FILTERS, search: "u1@exam" })).toBe(true);
    expect(matchesStaffQuery(person, { ...NO_FILTERS, search: "joe" })).toBe(false);
    expect(matchesStaffQuery({ ...person, display_name: null }, { ...NO_FILTERS, search: "jane" })).toBe(false);
  });

  it("cannot tell for a search with a character that may be a wildcard on the server, so the person stays", () => {
    for (const search of ["j_ne", "%", "a\\b"]) {
      expect(matchesStaffQuery(person, { ...NO_FILTERS, search })).toBe(true);
    }
    // The status and role filters are exact either way.
    expect(matchesStaffQuery(person, { ...NO_FILTERS, search: "j_ne", status: "disabled" })).toBe(false);
  });
});

describe("rolesAfterStagedChanges", () => {
  const held = roles("r1", "r2");
  const grant = (id: string, role: string) => ({ id, role, scope_type: "event", scope_id: "evt-9", is_oidc: false });

  it("drops the revoked assignments and adds the granted ones", () => {
    expect(rolesAfterStagedChanges(held, new Set(["r1"]), [grant("r3", "operator")])?.map((role) => role.id)).toEqual(["r2", "r3"]);
  });

  it("is the held roles when nothing was staged", () => {
    expect(rolesAfterStagedChanges(held, new Set(), [])).toEqual(held);
  });

  it("allows a first role for a person who held none, and the same type again after the last one was removed", () => {
    expect(rolesAfterStagedChanges([], new Set(), [grant("r3", "admin")])).toHaveLength(1);
    expect(rolesAfterStagedChanges(held, new Set(["r1", "r2"]), [grant("r3", "admin")])).toHaveLength(1);
  });

  it("does not claim to know the roles when a grant of another type may have replaced the held ones", () => {
    expect(rolesAfterStagedChanges(held, new Set(), [grant("r3", "admin")])).toBeNull();
    expect(rolesAfterStagedChanges([], new Set(), [grant("r3", "admin"), grant("r4", "operator")])).toBeNull();
  });
});

describe("staff users changes", () => {
  it("replaces the row of the person that was saved, and nobody else", () => {
    const one = makeStaffUser("u1", "One");
    const two = makeStaffUser("u2", "Two");
    const next = withUserReplaced(staff([one, two]), { ...one, display_name: "One renamed" }, 1);
    expect(next.users.map((user) => user.display_name)).toEqual(["One renamed", "Two"]);
    expect(next.users[1]).toBe(two);
    expect(next.total).toBe(2);
  });

  it("takes the person off the list when what was saved no longer fits the query, and counts them out", () => {
    const one = makeStaffUser("u1", "One");
    const two = makeStaffUser("u2", "Two");
    const answer = { ...staff([one, two], { ...NO_FILTERS, status: "active" }), total: 40 };
    const next = withUserReplaced(answer, { ...one, is_active: false }, 1);
    expect(next.users.map((user) => user.id)).toEqual(["u2"]);
    expect(next.total).toBe(39);
  });

  it("marks the answer as past the end when the person who left was the only one on a page after the first", () => {
    const one = makeStaffUser("u1", "One");
    const answer = { ...staff([one], { ...NO_FILTERS, search: "one" }), total: 26 };
    expect(withUserReplaced(answer, { ...one, display_name: "Another", email: "another@example.com" }, 2)).toMatchObject({
      users: [],
      total: 25,
      pastTheEnd: true,
    });
  });

  it("ignores a person who is not on the page", () => {
    const answer = staff([makeStaffUser("u1", "One")]);
    expect(withUserReplaced(answer, { ...makeStaffUser("other", "Other"), is_active: false }, 1).users).toBe(answer.users);
  });

  it("removes a deleted person and counts them out", () => {
    const next = withUserRemoved({ ...staff([makeStaffUser("u1", "One"), makeStaffUser("u2", "Two")]), total: 40 }, "u1", 1);
    expect(next.users.map((user) => user.id)).toEqual(["u2"]);
    expect(next.total).toBe(39);
    expect(next.pastTheEnd).toBe(false);
  });

  it("marks the answer as past the end when the deleted person was the only one on a page after the first", () => {
    const next = withUserRemoved({ ...staff([makeStaffUser("u1", "One")]), total: 26 }, "u1", 2);
    expect(next).toMatchObject({ users: [], total: 25, pastTheEnd: true });
  });

  it("changes nothing for a person who is not on the page", () => {
    const answer = staff([makeStaffUser("u1", "One")]);
    expect(withUserRemoved(answer, "other", 1)).toBe(answer);
  });

  it("never counts below zero", () => {
    expect(withUserRemoved({ ...staff([makeStaffUser("u1", "One")]), total: 0 }, "u1", 1).total).toBe(0);
  });

  it("takes a revoked assignment off the roles of its user only", () => {
    const one = { ...makeStaffUser("u1", "One"), roles: roles("r1", "r2") };
    const two = { ...makeStaffUser("u2", "Two"), roles: roles("r1") };
    const next = withRoleRemoved(staff([one, two]), "u1", "r1", 1);
    expect(next.users[0]!.roles.map((role) => role.id)).toEqual(["r2"]);
    expect(next.users[1]!.roles.map((role) => role.id)).toEqual(["r1"]);
  });

  it("takes the person off a list filtered by the role they have just lost", () => {
    const one = { ...makeStaffUser("u1", "One"), roles: roles("r1") };
    const two = { ...makeStaffUser("u2", "Two"), roles: roles("r2") };
    const next = withRoleRemoved({ ...staff([one, two], { ...NO_FILTERS, role: "operator" }), total: 30 }, "u1", "r1", 1);
    expect(next.users.map((user) => user.id)).toEqual(["u2"]);
    expect(next.total).toBe(29);
  });

  it("ignores a revoked assignment of a person who is not on the page", () => {
    const answer = staff([makeStaffUser("u1", "One")]);
    expect(withRoleRemoved(answer, "other", "r1", 1)).toBe(answer);
  });
});

describe("role assignment changes", () => {
  const rolesAnswer = (rows: RoleAssignmentListItemDto[], total = rows.length): RoleAssignmentsAnswer => ({ rows, total, filtersActive: false, pastTheEnd: false });

  it("removes a revoked assignment and counts it out", () => {
    const next = withAssignmentRemoved(rolesAnswer([assignment("a1"), assignment("a2")], 30), "a1", 1);
    expect(next.rows.map((row) => row.id)).toEqual(["a2"]);
    expect(next.total).toBe(29);
  });

  it("marks the answer as past the end when it was the only one on a page after the first", () => {
    expect(withAssignmentRemoved(rolesAnswer([assignment("a1")], 26), "a1", 2)).toMatchObject({ rows: [], total: 25, pastTheEnd: true });
  });

  it("changes nothing for an assignment that is not on the page", () => {
    const answer = rolesAnswer([assignment("a1")]);
    expect(withAssignmentRemoved(answer, "other", 1)).toBe(answer);
  });
});

describe("session changes", () => {
  const session = (id: string, deviceLabel: string | null = null) => ({ id, deviceLabel }) as SessionListDto;
  const answer: SessionsResponse = { sessions: [session("s1", "Old"), session("s2")] };

  it("removes a revoked session", () => {
    expect(withSessionRemoved(answer, "s1").sessions.map((s) => s.id)).toEqual(["s2"]);
  });

  it("gives a session the label that was saved, and clears it", () => {
    expect(withSessionLabel(answer, "s1", "New").sessions.map((s) => s.deviceLabel)).toEqual(["New", null]);
    expect(withSessionLabel(answer, "s1", null).sessions[0]!.deviceLabel).toBeNull();
  });
});
