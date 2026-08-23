/**
 * @admitto/auth — local accounts, opaque DB sessions, MFA, and RBAC (ADR 0011).
 */
export {
  SESSION_COOKIE_NAME,
  TRUSTED_DEVICE_COOKIE_NAME,
  SESSION_TTL_ADMIN_MS,
  SESSION_TTL_OPERATOR_MS,
  SESSION_IDLE_TIMEOUT_ADMIN_MS,
  SESSION_IDLE_TIMEOUT_OPERATOR_MS,
  MFA_PENDING_SESSION_TTL_MS,
  BACKUP_CODES_STEP_TTL_MS,
  SESSION_STAGE,
  LOGIN_NEXT,
  AUTH_METHOD,
  BACKUP_RECOVERY_CODE_COUNT,
  EMERGENCY_RECOVERY_LABEL,
  PASSWORD_MIN_LENGTH,
  type SessionStage,
  type LoginNext,
  type AuthMethod,
} from "./constants.js";

export { hashPassword, verifyPassword, verifyPasswordOrDummy } from "./password.js";
export {
  assertPasswordMeetsPolicy,
  PasswordPolicyError,
  type PasswordPolicyFailureCode,
} from "./password-policy.js";
export { isPasswordTooCommon, isPasswordBlocklisted, hasTrivialCharacterPattern, PASSWORD_TOO_COMMON_CODE, passwordTooCommonJsonBody } from "./password-blocklist.js";
export {
  scorePasswordStrength,
  scorePasswordStrengthInline,
  type PasswordStrengthLevel,
  type PasswordStrengthResult,
} from "./password-strength.js";
export {
  AUTH_PASSWORD_STRENGTH_CSS,
  passwordStrengthAuthScript,
} from "./password-strength-script.js";
export { normalizeEmail, isValidEmailFormat, createUser, findUserByEmail, findUserById } from "./user.js";
export {
  createSession,
  validateSession,
  validatePartialSession,
  promoteSessionToFull,
  promoteSessionToBackupCodesStep,
  revokeSession,
  revokeAllOperatorSessionsForEvent,
  updateSessionDeviceLabel,
  DEVICE_LABEL_MAX_LEN,
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
  getSessionIdleTimeoutAdminMs,
  getSessionIdleTimeoutOperatorMs,
  getTrustedDeviceDays,
  getMfaRequiredRoles,
  getWebauthnEnabled,
} from "./settings/resolver.js";
export {
  SETTING_SESSION_TTL,
  SETTING_OPERATOR_SESSION_TTL,
  SETTING_SESSION_IDLE_TIMEOUT,
  SETTING_OPERATOR_SESSION_IDLE_TIMEOUT,
  SETTING_TRUSTED_DEVICE_DAYS,
  SETTING_MFA_REQUIRED_ROLES,
  SETTING_CF_ACCESS_ENABLED,
  SETTING_CF_ACCESS_TEAM_DOMAIN,
  SETTING_CF_ACCESS_AUD,
  SETTING_CF_ACCESS_PROTECTED_PREFIXES,
  SETTING_CF_ACCESS_SOURCE_PROVIDER_ID,
  SETTING_SETUP_COMPLETE,
  SETTING_INSTANCE_URL,
  SETTING_WEBAUTHN_ENABLED,
  SETTING_CSP_TRUSTED_ORIGINS,
} from "./settings/keys.js";
export { getInstanceUrl } from "./settings/instance-url.js";
export {
  MAX_CSP_TRUSTED_ORIGINS,
  isValidCspTrustedOrigin,
  validateCspTrustedOrigins,
  CspTrustedOriginsError,
  sanitizeCspTrustedOrigins,
  getCspTrustedOrigins,
} from "./settings/csp-trusted-origins.js";
export {
  InstanceUrlRequiredError,
  normalizePersistedInstanceUrl,
  normalizeRuntimeBaseUrl,
  resolveInstanceBaseUrl,
} from "./settings/resolve-instance-base-url.js";
export { purgeAllSessions } from "./emergency-purge.js";
export type { PurgeAllSessionsOptions, PurgeAllSessionsResult } from "./emergency-purge.js";
export {
  resolveSetupComplete,
  markSetupIncomplete,
  markSetupComplete,
} from "./settings/setup-complete.js";
export {
  getCfAccessConfig,
  getCfAccessConfigCached,
  buildCfAccessConfigFromFields,
  resolveTeamDomainFromRaw,
  clearCfAccessRuntimeConfigCache,
  normalizeCfAccessTeamDomain,
  resolveCfAccessTeamDomainForConnection,
  validateCfAccessBootConfigFromResolved,
  validateCfAccessIdentityLinkConfig,
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
export {
  CF_ACCESS_IDENTITY_CLAIM,
  extractCfAccessSourceSubject,
  resolveCfAccessIdentityFromValidatedJwt,
  clearCfAccessIdentityCacheForTests,
  type ResolveCfAccessIdentityInput,
} from "./cloudflare-access/resolve-identity.js";
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
  locationPinFields,
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
  type BrandingFontVariant,
  type BrandingCustomFontFamily,
} from "./settings/branding.js";
export { SETTING_BRANDING_THEME } from "./settings/keys.js";
export {
  redactEmail,
  fingerprint,
  emitAuditEvent,
  logLoginSuccess,
  logLoginFailure,
  logMfaBreakGlass,
  logMfaBreakGlassCli,
  logMfaSuccess,
  logMfaFailure,
  logMfaRecoveryConsumed,
  logLogout,
  logRateLimitExceeded,
  logOidcLoginSuccess,
  logAccessDenied,
  logAuthSettingsChanged,
  type LoginAuditContext,
  type MfaAuditContext,
  type MfaFailureReason,
  type MfaMethod,
  type RateLimitScope,
  type AuthSettingsResource,
} from "./audit.js";
export {
  login,
  logout,
  completeMfa,
  completeMfaWithWebauthn,
  loginNextAfterFullSession,
  type LoginInput,
  type LoginResult,
  type CompleteMfaInput,
  type CompleteMfaResult,
  type CompleteMfaWithWebauthnInput,
} from "./login.js";
export {
  bootstrapSuperadmin,
  superadminInstanceExists,
  userIsInstanceSuperadmin,
} from "./bootstrap.js";
export { revokeUserAuthState, revokeOtherSessions } from "./revocation.js";
export { runInTransaction } from "./prisma-tx.js";
export {
  userRequiresMfa,
  userHasConfirmedTotp,
  userHasAnyConfirmedMfaMethod,
  userRequiresMfaStepUp,
  userHasUnacknowledgedBackupCodes,
  markBackupCodesAcknowledged,
} from "./mfa/policy.js";
export { verifyTotpOrRecoveryCode } from "./mfa/verify-step-up-code.js";
export {
  startTotpEnrollment,
  getOrStartTotpEnrollment,
  resumePendingTotpEnrollment,
  cancelPendingTotpEnrollment,
  confirmTotpEnrollment,
  verifyUserTotpCode,
  removeTotpMethod,
  resetUserMfa,
  type StartTotpEnrollmentResult,
} from "./mfa/enrollment.js";
export { parseTotpSecretFromOtpauthUri } from "./mfa/totp.js";
export {
  regenerateBackupRecoveryCodes,
  findBackupRecoveryRowId,
  verifyBackupRecoveryCodesSet,
  getBackupRecoveryCodesStatus,
  type BackupRecoveryCodesStatus,
} from "./mfa/backup-recovery.js";
export { generateEmergencyRecoveryCode } from "./mfa/emergency-recovery.js";
export {
  beginWebauthnRegistration,
  finishWebauthnRegistration,
  listWebauthnCredentials,
  removeWebauthnCredential,
  beginWebauthnAssertion,
  finishWebauthnAssertion,
  type WebauthnAttachment,
  type WebauthnRpConfig,
  type BeginWebauthnRegistrationResult,
  type FinishWebauthnRegistrationResult,
  type WebauthnCredentialSummary,
  type BeginWebauthnAssertionResult,
  type FinishWebauthnAssertionResult,
} from "./mfa/webauthn.js";
export {
  createTrustedDevice,
  validateTrustedDevice,
  revokeTrustedDeviceByToken,
  revokeAllTrustedDevicesForUser,
} from "./mfa/trusted-device.js";
export { purgeAuthRetention, purgeSecurityAuditLog, resolveSecurityAuditLogRetentionDays } from "./retention.js";

export {
  resolveOrCreateUserFromExternalIdentity,
  ExternalIdentityLinkError,
  type ExternalIdentityClaims,
  type ResolveExternalIdentityContext,
  type ResolveExternalIdentityResult,
} from "./external-identity/resolve-user.js";

export {
  resolveSsoLoginButtonLabel,
  normalizeSsoLoginButtonLabelInput,
} from "./oidc/login-button-label.js";
export {
  PROVIDER_TYPE_OIDC,
  PROVIDER_TYPE_CLOUDFLARE_ACCESS,
  OIDC_AUTH_STATE_TTL_MS,
  OIDC_FLOW_COOKIE_NAME,
  OIDC_LINK_STEP_UP_MAX_AGE_MS,
  DEFAULT_SSO_LOGIN_BUTTON_LABEL,
  SSO_LOGIN_BUTTON_LABEL_MAX_LEN,
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
export { resolveOidcEndSessionRedirect } from "./oidc/end-session.js";
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
