-- OIDC hardening: session auth_method; normalize OIDC tables created before NOT NULL fixes.

ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "auth_method" TEXT NOT NULL DEFAULT 'local';

UPDATE "OidcGroupRoleMapping" SET "scope_id" = '' WHERE "scope_id" IS NULL;
ALTER TABLE "OidcGroupRoleMapping" ALTER COLUMN "scope_id" SET DEFAULT '';
ALTER TABLE "OidcGroupRoleMapping" ALTER COLUMN "scope_id" SET NOT NULL;

UPDATE "ExternalIdentity" SET "groups" = ARRAY[]::TEXT[] WHERE "groups" IS NULL;
ALTER TABLE "ExternalIdentity" ALTER COLUMN "groups" SET NOT NULL;
