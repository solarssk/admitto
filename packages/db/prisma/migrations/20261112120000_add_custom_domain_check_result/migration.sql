-- What the last check of an event's own address found (v0.8, D-C6, PR 120). Additive only: one nullable column on
-- "EventRegistrationSettings". The status ('unchecked', 'ok', 'failing') says whether the address works; this says why it does not
-- (the name does not resolve, the certificate is refused, the answer is not ours, no answer), which is what the person who
-- fixes it needs to read. NULL until the first check, and again after the address changes. Nothing is changed or removed.

-- AlterTable
ALTER TABLE "EventRegistrationSettings" ADD COLUMN     "custom_domain_check_result" TEXT;

-- The six words a check can find (CUSTOM_DOMAIN_CHECK_RESULTS in @admitto/shared).
ALTER TABLE "EventRegistrationSettings" ADD CONSTRAINT "EventRegistrationSettings_custom_domain_result_check"
  CHECK ("custom_domain_check_result" IS NULL OR "custom_domain_check_result" IN ('ok', 'dns_failed', 'tls_failed', 'wrong_target', 'unreachable', 'not_verifiable_from_server'));

-- A result is a result of an address: a row cannot keep what was found about one that was removed.
ALTER TABLE "EventRegistrationSettings" ADD CONSTRAINT "EventRegistrationSettings_custom_domain_result_domain_check"
  CHECK ("custom_domain_check_result" IS NULL OR "custom_domain" IS NOT NULL);
