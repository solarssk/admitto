import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env['NODE_ENV'] !== 'production') globalForPrisma.prisma = prisma;

export {
  type AttendeeStatus,
  type EmailDeliveryPurpose,
  type EmailDeliveryStatus,
  type WalletPassStatus,
  type CheckInStatus,
  type AttendeeItemStateValue,
  type AttendeeActionType,
} from './status.js';

export {
  ATTENDEE_STATUS,
  EMAIL_DELIVERY_PURPOSE,
  EMAIL_DELIVERY_STATUS,
  EMAIL_DELIVERY_SUCCESS_STATUSES,
  WALLET_PASS_STATUS,
  CHECKIN_STATUS,
  ATTENDEE_ITEM_STATE,
  ATTENDEE_ACTION_TYPE,
  MAX_ATTENDEE_NOTE_LENGTH,
} from './status.js';

export {
  type Role,
  type ScopeType,
  ROLES,
  SCOPE_TYPES,
  hasScope,
} from './roles.js';

export {
  backfillAgencyPublicRefs,
  isAgencyAttendee,
} from './backfill-public-ref.js';
