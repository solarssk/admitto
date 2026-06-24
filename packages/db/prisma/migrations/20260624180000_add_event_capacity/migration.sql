-- Event capacity (nullable = unlimited). ADR 0027 additive migration.
ALTER TABLE "Event" ADD COLUMN "capacity" INTEGER;
