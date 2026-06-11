import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env['NODE_ENV'] !== 'production') globalForPrisma.prisma = prisma;

export {
  type AttendeeStatus,
  type EmailDeliveryStatus,
  type WalletPassStatus,
  type CheckInStatus,
} from './status.js';

export {
  ATTENDEE_STATUS,
  EMAIL_DELIVERY_STATUS,
  WALLET_PASS_STATUS,
  CHECKIN_STATUS,
} from './status.js';

export {
  type Role,
  type ScopeType,
  ROLES,
  SCOPE_TYPES,
  hasScope,
} from './roles.js';
