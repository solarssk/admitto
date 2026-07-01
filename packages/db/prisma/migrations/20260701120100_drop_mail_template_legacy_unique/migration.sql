-- Contract phase (v0.4.9 multi-template): allow multiple templates per scope.
-- destructive-approved: v0.4.8 app rollback is unsupported after this migration (ADR 0027 expand/contract).
DROP INDEX IF EXISTS "MailTemplate_scope_type_scope_id_key";
