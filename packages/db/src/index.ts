import { PrismaClient } from '@prisma/client';
import { emitSystemLog } from '@admitto/shared/system-log';
import { formatSlowQueryMessage, isSlowQuery } from './queryLogging.js';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });
  client.$on('query', (e) => {
    if (isSlowQuery(e.duration)) {
      emitSystemLog('db', 'info', formatSlowQueryMessage(e.query, e.duration), { durationMs: e.duration });
    }
  });
  client.$on('warn', (e) => {
    emitSystemLog('db', 'warn', e.message);
  });
  client.$on('error', (e) => {
    emitSystemLog('db', 'error', e.message);
  });
  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

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
  CAPACITY_EXCLUDED_STATUSES,
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

export {
  backfillEventCustomFields,
} from './backfill-event-custom-fields.js';

export {
  backfillCheckInSessionIds,
} from './backfill-checkin-session-id.js';
