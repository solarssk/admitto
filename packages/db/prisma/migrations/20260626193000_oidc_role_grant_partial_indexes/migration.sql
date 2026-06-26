-- DATA-004: PostgreSQL treats NULL values as distinct in standard UNIQUE indexes.
-- Replace the OidcRoleGrant logical uniqueness constraint with two partial indexes
-- so instance-scoped grants (scope_id IS NULL) are enforced correctly.

-- Existing installations may have duplicate instance-scope grants because the
-- previous standard UNIQUE index did not cover NULL scope_id. Keep the oldest
-- grant for each logical key; the RoleAssignment row remains the authority and
-- is already deduplicated by the role-assignment partial indexes.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id", "provider_id", "role", "scope_type", "scope_id"
      ORDER BY "created_at" ASC, "id" ASC
    ) AS rn
  FROM "OidcRoleGrant"
)
DELETE FROM "OidcRoleGrant" g
USING ranked
WHERE g."id" = ranked."id"
  AND ranked.rn > 1;

DROP INDEX IF EXISTS "OidcRoleGrant_user_id_provider_id_role_scope_type_scope_id_key";

CREATE UNIQUE INDEX "OidcRoleGrant_scoped_key"
  ON "OidcRoleGrant" ("user_id", "provider_id", "role", "scope_type", "scope_id")
  WHERE "scope_id" IS NOT NULL;

CREATE UNIQUE INDEX "OidcRoleGrant_instance_key"
  ON "OidcRoleGrant" ("user_id", "provider_id", "role", "scope_type")
  WHERE "scope_id" IS NULL;
