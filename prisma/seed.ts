import "dotenv/config";
import { randomInt } from "node:crypto";

import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  AccountKind,
  AccountStatus,
  KycStatus,
  LedgerAccountClass,
  PrismaClient,
  UserRole,
  UserStatus,
} from "../src/generated/prisma/client";

function luhnCheckDigit(value: string): string {
  let total = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if ((value.length - 1 - index) % 2 === 0) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    total += digit;
  }
  return ((10 - (total % 10)) % 10).toString();
}

function generatedAccountNumber(): string {
  let base = "88";
  for (let index = 0; index < 10; index += 1) {
    base += randomInt(0, 10).toString();
  }
  return base + luhnCheckDigit(base);
}

async function main() {
  if (process.env.SEED_DEMO_DATA !== "true") {
    throw new Error("Set SEED_DEMO_DATA=true before creating development seed data.");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  const email = (process.env.SEED_ADMIN_EMAIL || "admin@banknow.local").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "ChangeMe!2026BankNow";
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const passwordHash = await hash(password, {
      algorithm: 2,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
    const user = await db.user.upsert({
      where: { email },
      update: {
        role: UserRole.PLATFORM_ADMIN,
        status: UserStatus.ACTIVE,
        kycStatus: KycStatus.VERIFIED,
        emailVerifiedAt: new Date(),
      },
      create: {
        email,
        firstName: "Bank",
        lastName: "Admin",
        passwordHash,
        role: UserRole.PLATFORM_ADMIN,
        status: UserStatus.ACTIVE,
        kycStatus: KycStatus.VERIFIED,
        emailVerifiedAt: new Date(),
      },
    });

    await db.kycProfile.upsert({
      where: { userId: user.id },
      update: {
        status: KycStatus.VERIFIED,
        reviewedAt: new Date(),
        reviewedBy: user.id,
      },
      create: {
        userId: user.id,
        status: KycStatus.VERIFIED,
        reviewedAt: new Date(),
        reviewedBy: user.id,
      },
    });

    const account = await db.account.findFirst({
      where: { userId: user.id, isSystem: false },
    });
    if (!account) {
      await db.account.create({
        data: {
          userId: user.id,
          accountNumber: generatedAccountNumber(),
          displayName: "Bank Admin Wallet",
          currency: "KES",
          kind: AccountKind.WALLET,
          ledgerClass: LedgerAccountClass.LIABILITY,
          status: AccountStatus.ACTIVE,
        },
      });
    }

    console.info("Development administrator is ready.", { email });
  } finally {
    await db.$disconnect();
  }
}

void main();
