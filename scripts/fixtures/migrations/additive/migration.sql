-- additive migration fixture
CREATE TABLE "FixtureAdditive" (
    "id" TEXT NOT NULL,
    CONSTRAINT "FixtureAdditive_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FixtureAdditive" ADD COLUMN "note" TEXT;
