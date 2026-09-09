import { compare, hash } from "bcryptjs";

// Same library/cost factor playwright/seed.ts already uses (hashSync(..., 10))
// — just the async form, since this runs on real request paths, not a
// one-off test seed script.
const SALT_ROUNDS = 10;

export const hashPassword = (password: string) => hash(password, SALT_ROUNDS);
export const verifyPassword = (password: string, passwordHash: string) =>
  compare(password, passwordHash);

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
