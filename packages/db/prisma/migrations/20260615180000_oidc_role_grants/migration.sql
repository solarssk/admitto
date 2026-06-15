-- Track OIDC-provider-owned role grants so demotion does not remove manual assignments.

CREATE TABLE "OidcRoleGrant" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT,
    "role_assignment_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OidcRoleGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OidcRoleGrant_user_id_provider_id_role_scope_type_scope_id_key"
    ON "OidcRoleGrant"("user_id", "provider_id", "role", "scope_type", "scope_id");
CREATE INDEX "OidcRoleGrant_provider_id_user_id_idx" ON "OidcRoleGrant"("provider_id", "user_id");
CREATE INDEX "OidcRoleGrant_role_assignment_id_idx" ON "OidcRoleGrant"("role_assignment_id");

ALTER TABLE "OidcRoleGrant" ADD CONSTRAINT "OidcRoleGrant_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OidcRoleGrant" ADD CONSTRAINT "OidcRoleGrant_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "IdentityProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
