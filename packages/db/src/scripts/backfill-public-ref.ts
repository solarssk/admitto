import { prisma } from "../index.js";
import { backfillAgencyPublicRefs } from "../backfill-public-ref.js";

const result = await backfillAgencyPublicRefs(prisma);
console.log(`backfill-public-ref: updated ${result.updated} agency attendee(s)`);
await prisma.$disconnect();
