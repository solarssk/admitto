/**
 * @admitto/auth — local accounts, opaque DB sessions, MFA, and RBAC (ADR 0011).
 */
export {
  SESSION_COOKIE_NAME,
  TRUSTED_DEVICE_COOKIE_NAME,
  SESSION_TTL_ADMIN_MS,
  SESSION_TTL_OPERATOR_MS,
  MFA_PENDING_SESSION_TTL_MS,
  SESSION_STAGE,
  LOGIN_NEXT,
  BACKUP_RECOVERY_CODE_COUNT,
  EMERGENCY_RECOVERY_LABEL,
  type SessionStage,
  type LoginNext,
} from "./constants.js";

export { hashPassword, verifyPassword, verifyPasswordOrDummy } from "./password.js";
export { normalizeEmail, createUser, findUserByEmail, findUserById } from "./user.js";
export {
  createSession,
  validateSession,
  validatePartialSession,
  promoteSessionToFull,
  revokeSession,
  revokeAllOperatorSessionsForEvent,
  listSessions,
  type CreateSessionInput,
  type ValidatedSession,
  type ValidatedPartialSession,
  type ListSessionsFilters,
} from "./session.js";
export { operatorSessionTtlMs, adminSessionTtlMs, resolveSessionTtlMs } from "./session-ttl.js";
export {
  getSetting,
  getSessionTtlAdminMs,
  getSessionTtlOperatorMs,
  getTrustedDeviceDays,
  getMfaRequiredRoles,
} from "./settings/resolver.js";
export {
  canAccessEvent,
  canPerformCheckIn,
  canManageEvent,
  canManageInstance,
  checkCapability,
  type AuthCapability,
} from "./authorization.js";
export { redactEmail, logLoginSuccess, logLoginFailure, logMfaBreakGlass } from "./audit.js";
export { login, logout, completeMfa, type LoginInput, type LoginResult, type CompleteMfaInput } from "./login.js";
export {
  bootstrapSuperadmin,
  superadminInstanceExists,
  userIsInstanceSuperadmin,
} from "./bootstrap.js";
export { revokeUserAuthState } from "./revocation.js";
export { userRequiresMfa, userHasConfirmedTotp } from "./mfa/policy.js";
export {
  startTotpEnrollment,
  getOrStartTotpEnrollment,
  resumePendingTotpEnrollment,
  confirmTotpEnrollment,
  verifyUserTotpCode,
  resetUserMfa,
  type StartTotpEnrollmentResult,
} from "./mfa/enrollment.js";
export { regenerateBackupRecoveryCodes } from "./mfa/backup-recovery.js";
export { generateEmergencyRecoveryCode } from "./mfa/emergency-recovery.js";
export { validateTrustedDevice, revokeTrustedDeviceByToken, revokeAllTrustedDevicesForUser } from "./mfa/trusted-device.js";

export {
  resolveOrCreateUserFromExternalIdentity,
  ExternalIdentityLinkError,
  type ExternalIdentityClaims,
  type ResolveExternalIdentityContext,
  type ResolveExternalIdentityResult,
} from "./external-identity/resolve-user.js";

export {
  PROVIDER_TYPE_OIDC,
  PROVIDER_TYPE_CLOUDFLARE_ACCESS,
  OIDC_AUTH_STATE_TTL_MS,
} from "./oidc/constants.js";
export { generateCodeVerifier, codeChallengeS256, generateOauthSecret } from "./oidc/pkce.js";
export { fetchOidcDiscovery, testOidcConnection } from "./oidc/discovery.js";
export {
  createOidcAuthState,
  consumeOidcAuthState,
  sweepExpiredOidcAuthStates,
  type ConsumedOidcAuthState,
} from "./oidc/auth-state.js";
export { extractClaims } from "./oidc/claims.js";
export {
  exchangeAuthorizationCode,
  validateIdToken,
  exchangeAndValidateIdToken,
  clearJwksCacheForTests,
} from "./oidc/token.js";
export { encryptClientSecret, hasClientSecret } from "./oidc/provider-secret.js";
export {
  applyOidcGroupRoleMappings,
  preservesSuperadminInvariant,
} from "./oidc/group-role-mapping.js";
export {
  findEnabledOidcProviders,
  findOidcProviderById,
  listOidcProviders,
  createIdentityProvider,
  updateIdentityProvider,
  toProviderFormView,
  buildOidcRedirectUri,
  buildOidcAuthorizeUrl,
  replaceProviderGroupMappings,
  listProviderGroupMappings,
  type IdentityProviderInput,
  type IdentityProviderFormView,
  type GroupRoleMappingInput,
} from "./oidc/provider.js";
