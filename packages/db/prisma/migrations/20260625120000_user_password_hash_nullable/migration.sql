-- Additive (ADR 0027): OIDC-only accounts may have no local password hash.
ALTER TABLE "User" ALTER COLUMN "password_hash" DROP NOT NULL;
