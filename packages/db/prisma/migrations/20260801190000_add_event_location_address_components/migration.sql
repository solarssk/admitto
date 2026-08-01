-- Structured address parts for the Location tab's always-visible grid (Country / City / …).
-- Nullable JSON object; null means cleared / never geocoded with structured fields.
ALTER TABLE "EventLocation" ADD COLUMN "address_components" JSONB;
