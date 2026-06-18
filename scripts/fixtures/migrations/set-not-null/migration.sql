UPDATE "FixtureAdditive" SET "note" = '' WHERE "note" IS NULL;
ALTER TABLE "FixtureAdditive" ALTER COLUMN "note" SET DEFAULT '';
ALTER TABLE "FixtureAdditive" ALTER COLUMN "note" SET NOT NULL;
