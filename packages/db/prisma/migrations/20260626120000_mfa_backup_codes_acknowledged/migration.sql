-- Additive (ADR 0027): track backup-code acknowledgment so full-session promotion
-- cannot be bypassed by a fresh login or across processes (IAM-002).
--
-- Defaults to row-creation time so existing TOTP methods (and any direct inserts)
-- are treated as already acknowledged; only the live enrollment flow clears this
-- column at TOTP confirmation to force the user through the backup-codes step.
ALTER TABLE "UserMfaMethod"
  ADD COLUMN "backup_codes_acknowledged_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
