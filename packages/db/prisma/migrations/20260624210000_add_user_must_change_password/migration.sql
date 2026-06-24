-- Additive (ADR 0027): account self-service; existing rows keep password_hash unchanged.
ALTER TABLE "User" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ALTER COLUMN "password_hash" DROP NOT NULL;
