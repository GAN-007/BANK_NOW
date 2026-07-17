import { getDb } from "@/lib/db";
import { serializeMinor } from "@/lib/money";

export async function recentActivity(userId: string, take = 20) {
  const entries = await getDb().ledgerEntry.findMany({
    where: {
      account: {
        userId,
        isSystem: false,
      },
    },
    include: {
      account: {
        select: {
          displayName: true,
          accountNumber: true,
        },
      },
      journal: {
        select: {
          reference: true,
          narration: true,
          status: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take,
  });

  return entries.map((entry) => ({
    id: entry.id,
    accountName: entry.account.displayName,
    accountNumber: entry.account.accountNumber,
    direction: entry.direction,
    amountMinor: serializeMinor(entry.amountMinor),
    currency: entry.currency,
    narration: entry.journal.narration,
    status: entry.journal.status,
    reference: entry.journal.reference,
    createdAt: entry.createdAt.toISOString(),
  }));
}

export async function dashboardSnapshot(userId: string) {
  const [accounts, activity] = await Promise.all([
    getDb().account.findMany({
      where: {
        userId,
        isSystem: false,
      },
      orderBy: { createdAt: "asc" },
    }),
    recentActivity(userId, 8),
  ]);

  const balancesByCurrency = accounts.reduce<Record<string, bigint>>(
    (totals, account) => {
      totals[account.currency] =
        (totals[account.currency] ?? 0n) + account.availableBalanceMinor;
      return totals;
    },
    {},
  );

  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      accountNumber: account.accountNumber,
      displayName: account.displayName,
      currency: account.currency,
      kind: account.kind,
      status: account.status,
      availableBalanceMinor: serializeMinor(account.availableBalanceMinor),
      ledgerBalanceMinor: serializeMinor(account.ledgerBalanceMinor),
    })),
    balancesByCurrency: Object.fromEntries(
      Object.entries(balancesByCurrency).map(([currency, amount]) => [
        currency,
        serializeMinor(amount),
      ]),
    ),
    activity,
  };
}
