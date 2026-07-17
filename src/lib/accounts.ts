import { randomInt } from "node:crypto";

import {
  AccountKind,
  AccountStatus,
  LedgerAccountClass,
  type Prisma,
} from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { normalizeCurrency, serializeMinor } from "@/lib/money";

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

export function generateAccountNumber(): string {
  let base = "88";
  for (let index = 0; index < 10; index += 1) {
    base += randomInt(0, 10).toString();
  }
  return base + luhnCheckDigit(base);
}

export async function createCustomerWallet(
  tx: Prisma.TransactionClient,
  user: { id: string; firstName: string; lastName: string },
  currency = "KES",
): Promise<void> {
  await tx.account.create({
    data: {
      userId: user.id,
      accountNumber: generateAccountNumber(),
      displayName: user.firstName + " " + user.lastName + " Wallet",
      currency: normalizeCurrency(currency),
      kind: AccountKind.WALLET,
      ledgerClass: LedgerAccountClass.LIABILITY,
      status: AccountStatus.ACTIVE,
    },
  });
}

export async function ensureClearingAccount(
  tx: Prisma.TransactionClient,
  currency: string,
) {
  const normalizedCurrency = normalizeCurrency(currency);
  return tx.account.upsert({
    where: {
      accountNumber: "SYSTEM-CLEARING-" + normalizedCurrency,
    },
    create: {
      accountNumber: "SYSTEM-CLEARING-" + normalizedCurrency,
      displayName: normalizedCurrency + " Incoming Clearing",
      currency: normalizedCurrency,
      kind: AccountKind.CLEARING,
      ledgerClass: LedgerAccountClass.ASSET,
      status: AccountStatus.ACTIVE,
      isSystem: true,
    },
    update: {},
  });
}

export async function listUserAccounts(userId: string) {
  const accounts = await getDb().account.findMany({
    where: {
      userId,
      isSystem: false,
    },
    orderBy: { createdAt: "asc" },
  });

  return accounts.map((account) => ({
    id: account.id,
    accountNumber: account.accountNumber,
    displayName: account.displayName,
    currency: account.currency,
    kind: account.kind,
    status: account.status,
    availableBalanceMinor: serializeMinor(account.availableBalanceMinor),
    ledgerBalanceMinor: serializeMinor(account.ledgerBalanceMinor),
    createdAt: account.createdAt.toISOString(),
  }));
}

export async function getOwnedActiveAccount(input: {
  userId: string;
  accountId: string;
  currency?: string;
}) {
  const account = await getDb().account.findFirst({
    where: {
      id: input.accountId,
      userId: input.userId,
      isSystem: false,
      status: AccountStatus.ACTIVE,
      ...(input.currency ? { currency: normalizeCurrency(input.currency) } : {}),
    },
  });

  if (!account) {
    throw new AppError("ACCOUNT_NOT_FOUND", "Select an active account you own.", 404);
  }

  return account;
}

export async function resolveDestinationAccount(accountNumber: string) {
  const account = await getDb().account.findFirst({
    where: {
      accountNumber: accountNumber.replace(/\s/g, ""),
      isSystem: false,
      status: AccountStatus.ACTIVE,
    },
    select: {
      id: true,
      accountNumber: true,
      displayName: true,
      currency: true,
      userId: true,
    },
  });

  if (!account) {
    throw new AppError("DESTINATION_NOT_FOUND", "The recipient account could not be found.", 404);
  }

  return account;
}
