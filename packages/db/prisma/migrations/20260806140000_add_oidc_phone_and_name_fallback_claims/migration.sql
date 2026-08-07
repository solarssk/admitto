-- Configurable claim names for phone number and given/family name fallback (used when the
-- combined "name" claim is absent from the token), same pattern as claim_email/claim_name/claim_groups.
ALTER TABLE "IdentityProvider" ADD COLUMN "claim_given_name" TEXT NOT NULL DEFAULT 'given_name';
ALTER TABLE "IdentityProvider" ADD COLUMN "claim_family_name" TEXT NOT NULL DEFAULT 'family_name';
ALTER TABLE "IdentityProvider" ADD COLUMN "claim_phone" TEXT NOT NULL DEFAULT 'phone_number';

-- Last-synced phone claim value, mirrors ExternalIdentity.name's role in resolve-user.ts:
-- lets a later login detect whether User.phone_number still matches what we last synced, or
-- was manually overridden by a superadmin since then.
ALTER TABLE "ExternalIdentity" ADD COLUMN "phone" TEXT;
