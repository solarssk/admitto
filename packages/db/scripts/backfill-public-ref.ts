#!/usr/bin/env tsx
import { prisma } from "../src/index.js";
import { backfillAgencyPublicRefs } from "../src/backfill-public-ref.js";

const result = await backfillAgencyPublicRefs(prisma);
console.log(`backfill-public-ref: updated ${result.updated} agency attendee(s)`);
await prisma.$disconnect();
