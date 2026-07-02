import type { PrismaClient } from "@prisma/client";
import { purgeAuthRetention } from "@admitto/auth";
import { nullifyDeliverySnapshots } from "@admitto/mail-delivery";
import { hasFlag } from "../lib/args.js";

export async function runRetention(db: PrismaClient): Promise<void> {
  const dryRun = hasFlag("dry-run");

  const authResult = await purgeAuthRetention(db, { dryRun });
  const mailResult = await nullifyDeliverySnapshots(db, { dryRun });

  const verb = dryRun ? "Would purge/nullify" : "Purged/nullified";
  console.log(
    `${verb} auth: ${authResult.sessions} sessions, ${authResult.trustedDevices} trusted devices; ` +
      `mail: ${mailResult.deliveries} delivery snapshot(s).`,
  );
}
