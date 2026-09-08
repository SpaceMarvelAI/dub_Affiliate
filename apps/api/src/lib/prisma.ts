import { PrismaClient } from "@prisma/client";

// Standard dev-mode singleton: without this, `tsx watch` reloading src/*
// on every save would open a new PrismaClient (and a new DB connection
// pool) each time.
const globalForPrisma = global as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
