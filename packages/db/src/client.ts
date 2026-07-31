/**
 * @admitto/db/client — side-effect-free re-export of the generated Prisma client's class,
 * runtime `Prisma` namespace (`.sql`/`.empty`/`.join`, etc), and model types.
 *
 * Unlike the main `@admitto/db` entry point, importing this module never constructs a
 * PrismaClient instance — it has no top-level side effects. Use it from code that only needs
 * `Prisma`'s raw-query-building helpers or types (e.g. building a `$queryRaw` fragment) without
 * pulling in a live database connection — and, transitively, its driver adapter and Wasm query
 * compiler — into bundles that don't need one, such as the admin SPA's browser build.
 */
export {
  PrismaClient,
  Prisma,
  type Attendee,
  type IdentityProvider,
  type MailSettings,
  type Session,
  type TrustedDevice,
  type User,
} from './generated/prisma/client.js';
