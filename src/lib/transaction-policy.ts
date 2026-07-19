import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";

/**
 * Applies operator-approved limits while the transfer is inside its serializable
 * transaction. A missing or disabled policy fails closed; the application never
 * invents a financial limit for a jurisdiction or banking partner.
 */
export async function assertTransferWithinPolicy(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    currency: string;
    amountMinor: bigint;
    now?: Date;
  },
): Promise<void> {
  const policy = await tx.transactionPolicy.findUnique({
    where: { currency: input.currency },
  });

  if (!policy?.enabled) {
    throw new AppError(
      "TRANSFER_POLICY_UNAVAILABLE",
      "Transfers in this currency are temporarily unavailable.",
      503,
    );
  }

  if (input.amountMinor > policy.maximumAmountMinor) {
    throw new AppError(
      "TRANSFER_LIMIT_EXCEEDED",
      "This transfer exceeds the permitted per-transfer limit.",
      422,
    );
  }

  const now = input.now ?? new Date();
  const rollingWindowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const usage = await tx.transfer.aggregate({
    where: {
      initiatorId: input.userId,
      currency: input.currency,
      status: { in: ["PENDING", "POSTED"] },
      createdAt: { gte: rollingWindowStart, lte: now },
    },
    _count: { _all: true },
    _sum: { amountMinor: true },
  });

  if (usage._count._all + 1 > policy.rolling24HourCountLimit) {
    throw new AppError(
      "DAILY_TRANSFER_COUNT_EXCEEDED",
      "The rolling 24-hour transfer-count limit has been reached.",
      422,
    );
  }

  if (
    (usage._sum.amountMinor ?? 0n) + input.amountMinor >
    policy.rolling24HourAmountLimitMinor
  ) {
    throw new AppError(
      "DAILY_TRANSFER_LIMIT_EXCEEDED",
      "This transfer would exceed the permitted rolling 24-hour amount.",
      422,
    );
  }
}
