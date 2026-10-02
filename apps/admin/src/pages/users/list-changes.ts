import type {
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
export interface StaffUsersAnswer {
  users: UserListItemDto[];
  total: number;
  stats: UserStatsDto;
  /** What this answer was asked with, so the empty states never describe a search still on its way. */
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

export function withUserReplaced(answer: StaffUsersAnswer, updated: UserListItemDto): StaffUsersAnswer {
  return { ...answer, users: answer.users.map((user) => (user.id === updated.id ? updated : user)) };
}

export function withUserRemoved(answer: StaffUsersAnswer, userId: string, page: number): StaffUsersAnswer {
  const users = answer.users.filter((user) => user.id !== userId);
  if (users.length === answer.users.length) return answer;
  const total = Math.max(0, answer.total - 1);
  return { ...answer, users, total, pastTheEnd: isPastTheEnd(users.length, total, page) };
}

/** A revoked assignment leaves the roles of the user it belonged to. */
export function withRoleRemoved(answer: StaffUsersAnswer, userId: string, assignmentId: string): StaffUsersAnswer {
  return {
    ...answer,
    users: answer.users.map((user) =>
      user.id === userId ? { ...user, roles: user.roles.filter((role) => role.id !== assignmentId) } : user,
    ),
  };
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
