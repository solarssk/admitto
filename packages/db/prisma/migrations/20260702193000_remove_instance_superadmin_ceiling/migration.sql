-- v0.4.10: allow multiple instance-scoped superadmins (ADR 0011 amendment).
-- First-run bootstrap protection remains via Serializable user.count() in POST /setup.
DROP INDEX IF EXISTS "RoleAssignment_single_superadmin_key";
