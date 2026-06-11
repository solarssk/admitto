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

-- Only instance scope may have a null scope_id.
-- organization and event scopes require an explicit scope_id.
ALTER TABLE "RoleAssignment"
  ADD CONSTRAINT "RoleAssignment_scope_id_check"
    CHECK (scope_type = 'instance' OR scope_id IS NOT NULL);
