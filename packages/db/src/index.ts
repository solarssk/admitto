import { emitSystemLog } from '@admitto/shared/system-log';
import { formatSlowQueryMessage, isSlowQuery } from './queryLogging.js';
import { PrismaClient } from './generated/prisma/client.js';
import { createPrismaAdapter } from './adapter.js';

export * from './client.js';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const client = new PrismaClient({
    adapter: createPrismaAdapter(process.env.DATABASE_URL),
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
  type AdminJobType,
  type AdminJobStatus,
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
  ADMIN_JOB_TYPE,
  ADMIN_JOB_STATUS,
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

export {
  backfillEventCreatedByUserId,
  backfillEventArchivedByUserId,
} from './backfill-event-actor-attribution.js';

export {
  backfillEmailDeliveryTemplateLabelSnapshot,
} from './backfill-email-delivery-template-label-snapshot.js';

export {
  isSerializationFailure,
} from './errors.js';

export {
  WORKER_HEARTBEAT_ID,
  DEFAULT_WORKER_HEARTBEAT_STALE_MS,
  workerHeartbeatStaleMs,
  positiveMsOr,
  isWorkerHeartbeatStale,
  staleAdminJobOrClauses,
} from './worker-heartbeat.js';
