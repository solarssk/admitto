export { SESSION_COOKIE_NAME, SESSION_TTL_ADMIN_MS, SESSION_TTL_OPERATOR_MS } from "./constants.js";

export { hashPassword, verifyPassword, verifyPasswordOrDummy } from "./password.js";
export { normalizeEmail, createUser, findUserByEmail, findUserById } from "./user.js";
export {
  createSession,
  validateSession,
  revokeSession,
  revokeAllOperatorSessionsForEvent,
  listSessions,
  type CreateSessionInput,
  type ValidatedSession,
  type ListSessionsFilters,
} from "./session.js";
export { operatorSessionTtlMs, adminSessionTtlMs, resolveSessionTtlMs } from "./session-ttl.js";
export {
  canAccessEvent,
  canPerformCheckIn,
  canManageEvent,
  canManageInstance,
  checkCapability,
  type AuthCapability,
} from "./authorization.js";
export { redactEmail, logLoginSuccess, logLoginFailure } from "./audit.js";
export { login, logout, type LoginInput, type LoginResult } from "./login.js";
export {
  bootstrapSuperadmin,
  superadminInstanceExists,
  userIsInstanceSuperadmin,
} from "./bootstrap.js";
