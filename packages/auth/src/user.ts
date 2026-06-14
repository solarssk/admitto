import type { PrismaClient, Prisma, User } from "@prisma/client";
import { hashPassword } from "./password.js";

/** Normalize email for storage and lookup (lowercase, trimmed). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Input for creating a local password-based user. */
export interface CreateUserInput {
  email: string;
  password: string;
  displayName?: string;
  isActive?: boolean;
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
      is_active: input.isActive ?? true,
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
