import type {
  RoleAssignmentDto,
  RoleAssignmentListItemDto,
  SessionListDto,
  SessionsResponse,
  UserListItemDto,
  UserStatsDto,
} from "../../api/types.js";

/**
 * What the three Users & roles lists hold as their answer (`useListLoad`), and the changes an action makes to it once
 * the server has confirmed it. They are applied with `list.update` before the refresh that follows the action, so a
 * refresh that fails does not make a saved change look lost (a deleted row still there, an edited name still old).
 */
/** What a Staff users answer was asked with: the search (already trimmed), the role and the status filter. */
export interface StaffQuery {
  search: string;
  role: string;
  status: string;
}

export interface StaffUsersAnswer {
  users: UserListItemDto[];
  total: number;
  stats: UserStatsDto;
  /** What this answer was asked with, so a changed person can be checked against it, as the server would have. */
  query: StaffQuery;
  /** Whether the query narrows the list, so the empty states never describe a search still on its way. */
  filtersActive: boolean;
  /** No rows although there are some, on a page after the first: the page it was on is gone. */
  pastTheEnd: boolean;
}

export interface RoleAssignmentsAnswer {
  rows: RoleAssignmentListItemDto[];
  total: number;
  filtersActive: boolean;
  pastTheEnd: boolean;
}

/** No rows although there are some, on a page after the first: the page that was asked for is gone. */
export function isPastTheEnd(rowCount: number, total: number, page: number): boolean {
  return rowCount === 0 && total > 0 && page > 1;
}

/** Whether the server's list for `query` would contain this person (the same rules as `GET /api/admin/users`). */
export function matchesStaffQuery(user: UserListItemDto, query: StaffQuery): boolean {
  if (query.status === "active" && !user.is_active) return false;
  if (query.status === "disabled" && user.is_active) return false;
  if (query.role !== "all" && !user.roles.some((role) => role.role === query.role)) return false;
  const search = query.search.toLowerCase();
  // The server's search is an ILIKE: a `%`, `_` or `\` in it may act as a wildcard, which a plain match cannot follow.
  // When it cannot tell, the person stays and the refresh decides.
  if (!search || /[%_\\]/.test(search)) return true;
  return user.email.toLowerCase().includes(search) || (user.display_name ?? "").toLowerCase().includes(search);
}

/**
 * The roles a person holds after a profile save with staged role changes: what the PATCH answered, without the
 * revoked assignments, plus the granted ones. `null` when the server may have done more than that: a grant of another
 * type than the one held replaces the assignments of the old type, so the list is left to its refresh.
 */
export function rolesAfterStagedChanges(
  held: RoleAssignmentDto[],
  revokedIds: ReadonlySet<string>,
  granted: RoleAssignmentDto[],
): RoleAssignmentDto[] | null {
  const kept = held.filter((role) => !revokedIds.has(role.id));
  const types = new Set([...kept, ...granted].map((role) => role.role));
  return granted.length > 0 && types.size > 1 ? null : [...kept, ...granted];
}

export function withUserRemoved(answer: StaffUsersAnswer, userId: string, page: number): StaffUsersAnswer {
  const users = answer.users.filter((user) => user.id !== userId);
  if (users.length === answer.users.length) return answer;
  const total = Math.max(0, answer.total - 1);
  return { ...answer, users, total, pastTheEnd: isPastTheEnd(users.length, total, page) };
}

/**
 * The person as the server has them now. When that no longer fits the list's query (disabled under the Active
 * filter, another role under a role filter, a name the search does not match) they leave the list, as they would
 * from the server's next answer.
 */
export function withUserReplaced(answer: StaffUsersAnswer, saved: UserListItemDto, page: number): StaffUsersAnswer {
  if (!answer.users.some((user) => user.id === saved.id)) return answer;
  if (!matchesStaffQuery(saved, answer.query)) return withUserRemoved(answer, saved.id, page);
  return { ...answer, users: answer.users.map((user) => (user.id === saved.id ? saved : user)) };
}

/** A revoked assignment leaves the roles of the user it belonged to (and the user the list, if that was the role it was filtered by). */
export function withRoleRemoved(answer: StaffUsersAnswer, userId: string, assignmentId: string, page: number): StaffUsersAnswer {
  const person = answer.users.find((user) => user.id === userId);
  if (!person) return answer;
  return withUserReplaced(answer, { ...person, roles: person.roles.filter((role) => role.id !== assignmentId) }, page);
}

export function withAssignmentRemoved(answer: RoleAssignmentsAnswer, assignmentId: string, page: number): RoleAssignmentsAnswer {
  const rows = answer.rows.filter((row) => row.id !== assignmentId);
  if (rows.length === answer.rows.length) return answer;
  const total = Math.max(0, answer.total - 1);
  return { ...answer, rows, total, pastTheEnd: isPastTheEnd(rows.length, total, page) };
}

export function withSessionRemoved(answer: SessionsResponse, sessionId: string): SessionsResponse {
  return { ...answer, sessions: answer.sessions.filter((session) => session.id !== sessionId) };
}

export function withSessionLabel(answer: SessionsResponse, sessionId: string, deviceLabel: string | null): SessionsResponse {
  return {
    ...answer,
    sessions: answer.sessions.map((session: SessionListDto) => (session.id === sessionId ? { ...session, deviceLabel } : session)),
  };
}
