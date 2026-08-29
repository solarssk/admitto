-- No PassCreator API support yet (unlike apple/google, nothing ever issues a real Samsung pass or
-- shows an attendee-facing button) - exists so the toggle-and-reporting plumbing (Event Settings,
-- Reports' platform breakdown) is already in place for whenever PassCreator adds it.
ALTER TABLE "Event" ADD COLUMN     "wallet_samsung_enabled" BOOLEAN NOT NULL DEFAULT true;
