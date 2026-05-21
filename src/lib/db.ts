/**
 * Prisma client singleton.
 *
 * In dev, Next.js HMR can spawn multiple PrismaClient instances and exhaust
 * the connection pool. We attach the instance to globalThis to reuse it.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type Prisma = typeof prisma;
