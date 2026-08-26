-- Optional event category (Apple PKEventType vocabulary), exposed as the `event_type` Wallet
-- field-mapping placeholder. Same pattern as MailSettings.provider (20260612120000_mail_settings).
ALTER TABLE "Event" ADD COLUMN "event_type" TEXT;

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_event_type_check"
    CHECK (
      event_type IS NULL OR
      event_type IN ('generic', 'live_performance', 'movie', 'sports', 'conference', 'convention', 'workshop', 'social_gathering')
    );
