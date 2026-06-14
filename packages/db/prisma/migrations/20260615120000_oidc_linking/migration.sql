-- OIDC linking (prompt 16b): IdentityProvider, ExternalIdentity, group mapping, auth state.

CREATE TABLE "IdentityProvider" (
    "id" TEXT NOT NULL,
    "provider_type" TEXT NOT NULL DEFAULT 'oidc',
    "issuer" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_enc" TEXT,
    "authorization_endpoint" TEXT NOT NULL,
    "token_endpoint" TEXT NOT NULL,
    "jwks_uri" TEXT NOT NULL,
    "userinfo_endpoint" TEXT,
    "claim_email" TEXT NOT NULL DEFAULT 'email',
    "claim_name" TEXT NOT NULL DEFAULT 'name',
    "claim_groups" TEXT NOT NULL DEFAULT 'groups',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityProvider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdentityProvider_issuer_key" ON "IdentityProvider"("issuer");

CREATE TABLE "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalIdentity_provider_id_subject_key" ON "ExternalIdentity"("provider_id", "subject");
CREATE INDEX "ExternalIdentity_user_id_idx" ON "ExternalIdentity"("user_id");

CREATE TABLE "OidcGroupRoleMapping" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OidcGroupRoleMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OidcGroupRoleMapping_provider_id_group_role_scope_type_scope_id_key"
    ON "OidcGroupRoleMapping"("provider_id", "group", "role", "scope_type", "scope_id");
CREATE INDEX "OidcGroupRoleMapping_provider_id_idx" ON "OidcGroupRoleMapping"("provider_id");

CREATE TABLE "OidcAuthState" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "redirect_next" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OidcAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OidcAuthState_state_key" ON "OidcAuthState"("state");
CREATE INDEX "OidcAuthState_expires_at_idx" ON "OidcAuthState"("expires_at");
CREATE INDEX "OidcAuthState_provider_id_idx" ON "OidcAuthState"("provider_id");

ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "IdentityProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OidcGroupRoleMapping" ADD CONSTRAINT "OidcGroupRoleMapping_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "IdentityProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OidcAuthState" ADD CONSTRAINT "OidcAuthState_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "IdentityProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
