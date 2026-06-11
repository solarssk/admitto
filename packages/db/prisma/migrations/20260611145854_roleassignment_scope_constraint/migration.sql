-- Defense in depth for RoleAssignment RBAC rows (v0.2.4 hardening).
-- TypeScript union types (Role, ScopeType) and hasScope() already enforce these at the
-- application layer. These constraints close the gap for any insert path outside the TS runtime:
-- raw SQL, future migrations, scripts, or ORM calls that bypass hasScope().
--
-- Greenfield assumption: RoleAssignment was created empty in v0.2.3 (no application code
-- inserts rows yet). No preflight cleanup is needed before adding these constraints.

ALTER TABLE "RoleAssignment"
  ADD CONSTRAINT "RoleAssignment_role_check"
    CHECK (role IN ('superadmin', 'admin', 'operator'));

ALTER TABLE "RoleAssignment"
  ADD CONSTRAINT "RoleAssignment_scope_type_check"
    CHECK (scope_type IN ('instance', 'organization', 'event'));

-- scope_id must match scope_type exactly:
--   instance  → scope_id must be NULL  (no target entity)
--   organization / event → scope_id must be NOT NULL  (target entity required)
ALTER TABLE "RoleAssignment"
  ADD CONSTRAINT "RoleAssignment_scope_id_check"
    CHECK (
      (scope_type = 'instance'    AND scope_id IS NULL) OR
      (scope_type = 'organization' AND NULLIF(BTRIM(scope_id), '') IS NOT NULL) OR
      (scope_type = 'event'        AND NULLIF(BTRIM(scope_id), '') IS NOT NULL)
    );
