import type { PrismaClient, Prisma, User } from "@admitto/db";
import { hashPassword } from "./password.js";

/** Normalize email for storage and lookup (lowercase, trimmed). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Pragmatic format check (not full RFC 5322) - one @, something on each side, a dot in the
 * domain part. Applied where an operator submits a new email (invite, edit); intentionally not
 * applied to normalizeEmail itself, which is also used to look up/normalize already-stored or
 * IdP-asserted addresses that must keep working even if unusual. */
export function isValidEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Input for creating a local password-based user. */
export interface CreateUserInput {
  email: string;
  password: string;
  displayName?: string;
  phoneCountryCode?: string;
  phoneNumber?: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
}

/** Create a user with argon2id-hashed password and normalized email. */
export async function createUser(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: CreateUserInput,
): Promise<User> {
  const email = normalizeEmail(input.email);
  const password_hash = await hashPassword(input.password);
  return prisma.user.create({
    data: {
      email,
      password_hash,
      display_name: input.displayName ?? null,
      phone_country_code: input.phoneCountryCode ?? null,
      phone_number: input.phoneNumber ?? null,
      is_active: input.isActive ?? true,
      must_change_password: input.mustChangePassword ?? false,
    },
  });
}

/** Lookup by normalized email. */
export async function findUserByEmail(
  prisma: PrismaClient | Prisma.TransactionClient,
  email: string,
): Promise<User | null> {
  return prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  });
}

/** Lookup by primary key. */
export async function findUserById(
  prisma: PrismaClient | Prisma.TransactionClient,
  id: string,
): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}
