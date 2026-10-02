import { describe, expect, it } from "vitest";
import type { RoleAssignmentListItemDto, SessionListDto, SessionsResponse, UserListItemDto, UserStatsDto } from "../../../src/api/types.js";
import {
  isPastTheEnd,
  withAssignmentRemoved,
  withRoleRemoved,
  withSessionLabel,
  withSessionRemoved,
  withUserRemoved,
  withUserReplaced,
  type RoleAssignmentsAnswer,
  type StaffUsersAnswer,
} from "../../../src/pages/users/list-changes.js";
import { makeStaffUser } from "../../test-utils.js";

const stats = { total: 2 } as UserStatsDto;
const staff = (...users: UserListItemDto[]): StaffUsersAnswer => ({ users, total: users.length, stats, filtersActive: false, pastTheEnd: false });
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

describe("staff users changes", () => {
  it("replaces the row of the person that was saved, and nobody else", () => {
    const one = makeStaffUser("u1", "One");
    const two = makeStaffUser("u2", "Two");
    const next = withUserReplaced(staff(one, two), { ...one, display_name: "One renamed" });
    expect(next.users.map((user) => user.display_name)).toEqual(["One renamed", "Two"]);
    expect(next.users[1]).toBe(two);
  });

  it("removes a deleted person and counts them out", () => {
    const next = withUserRemoved({ ...staff(makeStaffUser("u1", "One"), makeStaffUser("u2", "Two")), total: 40 }, "u1", 1);
    expect(next.users.map((user) => user.id)).toEqual(["u2"]);
    expect(next.total).toBe(39);
    expect(next.pastTheEnd).toBe(false);
  });

  it("marks the answer as past the end when the deleted person was the only one on a page after the first", () => {
    const next = withUserRemoved({ ...staff(makeStaffUser("u1", "One")), total: 26 }, "u1", 2);
    expect(next).toMatchObject({ users: [], total: 25, pastTheEnd: true });
  });

  it("changes nothing for a person who is not on the page", () => {
    const answer = staff(makeStaffUser("u1", "One"));
    expect(withUserRemoved(answer, "other", 1)).toBe(answer);
  });

  it("never counts below zero", () => {
    expect(withUserRemoved({ ...staff(makeStaffUser("u1", "One")), total: 0 }, "u1", 1).total).toBe(0);
  });

  it("takes a revoked assignment off the roles of its user only", () => {
    const one = { ...makeStaffUser("u1", "One"), roles: roles("r1", "r2") };
    const two = { ...makeStaffUser("u2", "Two"), roles: roles("r1") };
    const next = withRoleRemoved(staff(one, two), "u1", "r1");
    expect(next.users[0]!.roles.map((role) => role.id)).toEqual(["r2"]);
    expect(next.users[1]!.roles.map((role) => role.id)).toEqual(["r1"]);
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
