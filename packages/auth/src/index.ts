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
  AUTH_METHOD,
  BACKUP_RECOVERY_CODE_COUNT,
  EMERGENCY_RECOVERY_LABEL,
  type SessionStage,
  type LoginNext,
  type AuthMethod,
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
  setSetting,
  isSettingEnvLocked,
  getSessionTtlAdminMs,
  getSessionTtlOperatorMs,
  getTrustedDeviceDays,
  getMfaRequiredRoles,
} from "./settings/resolver.js";
export {
  SETTING_SESSION_TTL,
  SETTING_OPERATOR_SESSION_TTL,
  SETTING_TRUSTED_DEVICE_DAYS,
  SETTING_MFA_REQUIRED_ROLES,
  SETTING_CF_ACCESS_ENABLED,
  SETTING_CF_ACCESS_TEAM_DOMAIN,
  SETTING_CF_ACCESS_AUD,
  SETTING_CF_ACCESS_PROTECTED_PREFIXES,
} from "./settings/keys.js";
export {
  getCfAccessConfig,
  getCfAccessConfigCached,
  buildCfAccessConfigFromFields,
  resolveTeamDomainFromRaw,
  clearCfAccessRuntimeConfigCache,
  normalizeCfAccessTeamDomain,
  resolveCfAccessTeamDomainForConnection,
  validateCfAccessBootConfigFromResolved,
  pathMatchesCfProtectedPrefix,
  type CfAccessConfig,
} from "./cloudflare-access/config.js";
export {
  extractAccessTokenFromHeaders,
  CF_ACCESS_HEADER,
  CF_ACCESS_COOKIE,
} from "./cloudflare-access/extract-token.js";
export {
  validateAccessJwt,
  CfAccessJwtError,
  isServiceTokenShape,
  clearCfAccessJwksCacheForTests,
} from "./cloudflare-access/validate.js";
export { logCfAccessAuth } from "./cloudflare-access/log.js";
export { testCfAccessConnection } from "./cloudflare-access/test-connection.js";
export {
  ensureCloudflareAccessProvider,
  findCloudflareAccessProvider,
  CF_ACCESS_CLIENT_ID_SENTINEL,
  CF_ACCESS_DISPLAY_NAME,
} from "./cloudflare-access/provider.js";
export {
  canAccessEvent,
  canPerformCheckIn,
  canManageEvent,
  canManageInstance,
  canAccessAdminPanel,
  canAccessCheckInPanel,
  listCheckInEvents,
  listAdminEvents,
  checkCapability,
  type AuthCapability,
  type EventSummary,
} from "./authorization.js";
export {
  resolvePostAuthPath,
  isAdminRoleAssignment,
  type RoleAssignmentLike,
} from "./post-auth.js";
export {
  getBrandingTheme,
  setBrandingTheme,
  type BrandingTheme,
} from "./settings/branding.js";
export { SETTING_BRANDING_THEME } from "./settings/keys.js";
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
export { regenerateBackupRecoveryCodes, findBackupRecoveryRowId } from "./mfa/backup-recovery.js";
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
  OIDC_FLOW_COOKIE_NAME,
  OIDC_LINK_STEP_UP_MAX_AGE_MS,
} from "./oidc/constants.js";
export { generateCodeVerifier, codeChallengeS256, generateOauthSecret } from "./oidc/pkce.js";
export { assertSafeOidcFetchUrl } from "./oidc/safe-url.js";
export { fetchOidcDiscovery, testOidcConnection } from "./oidc/discovery.js";
export {
  createOidcAuthState,
  consumeOidcAuthState,
  sweepExpiredOidcAuthStates,
  type ConsumedOidcAuthState,
} from "./oidc/auth-state.js";
export {
  verifyOidcLinkStepUp,
  type VerifyOidcLinkStepUpInput,
  type VerifyOidcLinkStepUpResult,
  type OidcLinkStepUpFailureReason,
} from "./oidc/link-step-up.js";
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
  createIdentityProviderWithMappings,
  updateIdentityProviderWithMappings,
  toProviderFormView,
  buildOidcRedirectUri,
  buildOidcAuthorizeUrl,
  replaceProviderGroupMappings,
  listProviderGroupMappings,
  type IdentityProviderInput,
  type IdentityProviderFormView,
  type GroupRoleMappingInput,
} from "./oidc/provider.js";
