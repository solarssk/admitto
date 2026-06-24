-- Event capacity (nullable = unlimited). ADR 0027 additive migration.
ALTER TABLE "Event" ADD COLUMN "capacity" INTEGER;
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_capacity_positive" CHECK ("capacity" IS NULL OR "capacity" > 0);
