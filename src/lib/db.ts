import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getDb(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  const adapter = new PrismaPg({
    connectionString: getEnv().DATABASE_URL,
  });

  const client = new PrismaClient({ adapter });
  // One pool per Node.js runtime prevents a new PostgreSQL connection pool
  // from being created for every request in a long-lived production process.
  globalForPrisma.prisma = client;
  return globalForPrisma.prisma;
}
