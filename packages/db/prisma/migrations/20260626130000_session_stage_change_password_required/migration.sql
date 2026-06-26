-- Forced password change: dedicated session stage before full access (IAM-001).
ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_stage_check";

ALTER TABLE "Session" ADD CONSTRAINT "Session_stage_check"
    CHECK ("stage" IN ('full', 'mfa_pending', 'enrollment_required', 'backup_codes_required', 'change_password_required'));
