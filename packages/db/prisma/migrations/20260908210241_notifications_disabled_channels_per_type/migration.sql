/*
  Warnings:

  - You are about to drop the column `disabled_types` on the `NotificationSettings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "NotificationSettings" DROP COLUMN "disabled_types",
ADD COLUMN     "disabled_channels" JSONB;
