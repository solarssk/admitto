-- Additive (ADR 0027): force password change after admin reset; existing rows default false.
ALTER TABLE "User" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
