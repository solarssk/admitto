/*
  Warnings:

  - You are about to drop the column `disabled_types` on the `NotificationSettings` table. All the data in the column will be lost.

*/
-- destructive-approved: disabled_types was added by this same not-yet-released notifications
-- module (no GA yet, no backward-compatibility constraint - see AGENTS.md) and never reached a
-- real deployment; replaced here by the richer per-channel disabled_channels column.
-- AlterTable
ALTER TABLE "NotificationSettings" DROP COLUMN "disabled_types",
ADD COLUMN     "disabled_channels" JSONB;
