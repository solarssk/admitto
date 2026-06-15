-- OIDC account linking: record password/TOTP step-up on auth state.

ALTER TABLE "OidcAuthState" ADD COLUMN IF NOT EXISTS "link_step_up_at" TIMESTAMP(3);
