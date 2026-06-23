-- MFA enroll: separate backup-codes step after TOTP confirm (before full session).
ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_stage_check";

ALTER TABLE "Session" ADD CONSTRAINT "Session_stage_check"
    CHECK ("stage" IN ('full', 'mfa_pending', 'enrollment_required', 'backup_codes_required'));
