import { randomUUID } from "node:crypto";

import {
  AccountStatus,
  EntryDirection,
  JournalStatus,
  Prisma,
  TransferStatus,
} from "@/generated/prisma/client";
import { ensureClearingAccount } from "@/lib/accounts";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { normalizeCurrency } from "@/lib/money";
import { assertTransferWithinPolicy } from "@/lib/transaction-policy";

function reference(prefix: string): string {
  return prefix + "-" + randomUUID().replace(/-/g, "").toUpperCase();
}

async function lockRows(
  tx: Prisma.TransactionClient,
  table: "Account" | "PaymentIntent",
  identifiers: string[],
): Promise<void> {
  const placeholders = identifiers.map((_, index) => "$" + (index + 1)).join(", ");
  const sql =
    'SELECT "id" FROM "' +
    table +
    '" WHERE "id" IN (' +
    placeholders +
    ') ORDER BY "id" FOR UPDATE';

  await tx.$executeRawUnsafe(sql, ...identifiers);
}

const RETRYABLE_SQL_STATES = new Set(["40001", "40P01"]);

function containsRetryableSqlState(
  value: unknown,
  visited: Set<object> = new Set(),
): boolean {
  if (typeof value === "string") {
    return RETRYABLE_SQL_STATES.has(value);
  }
  if (typeof value !== "object" || value === null || visited.has(value)) {
    return false;
  }

  visited.add(value);
  return Object.values(value).some((entry) =>
    containsRetryableSqlState(entry, visited),
  );
}

export function isRetryableTransactionError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  return (
    error.code === "P2034" ||
    error.code === "P2002" ||
    (error.code === "P2010" && containsRetryableSqlState(error.meta))
  );
}

function sameTransferRequest(
  existing: {
    sourceAccountId: string;
    destinationAccountId: string;
    amountMinor: bigint;
    currency: string;
    memo: string | null;
  },
  input: {
    sourceAccountId: string;
    destinationAccountId: string;
    amountMinor: bigint;
    currency: string;
    memo?: string;
  },
): boolean {
  return (
    existing.sourceAccountId === input.sourceAccountId &&
    existing.destinationAccountId === input.destinationAccountId &&
    existing.amountMinor === input.amountMinor &&
    existing.currency === input.currency &&
    (existing.memo ?? undefined) === input.memo
  );
}

async function serializableWithRetry<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const maximumAttempts = 5;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await getDb().$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === maximumAttempts) {
        throw error;
      }
      const backoffMilliseconds =
        25 * 2 ** (attempt - 1) + Math.floor(Math.random() * 25);
      await new Promise((resolve) => setTimeout(resolve, backoffMilliseconds));
    }
  }
  throw new Error("Serializable transaction retry loop terminated unexpectedly.");
}

export async function postInternalTransfer(input: {
  initiatorId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinor: bigint;
  currency: string;
  memo?: string;
  idempotencyKey: string;
}): Promise<{
  id: string;
  status: TransferStatus;
  amountMinor: bigint;
  currency: string;
  createdAt: Date;
}> {
  const currency = normalizeCurrency(input.currency);
  if (input.sourceAccountId === input.destinationAccountId) {
    throw new AppError("INVALID_DESTINATION", "Choose a different recipient account.", 422);
  }

  return serializableWithRetry(
    async (tx) => {
      const existing = await tx.transfer.findUnique({
        where: {
          initiatorId_idempotencyKey: {
            initiatorId: input.initiatorId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });

      if (existing) {
        if (!sameTransferRequest(existing, { ...input, currency })) {
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "This idempotency key was already used for a different transfer.",
            409,
          );
        }
        return {
          id: existing.id,
          status: existing.status,
          amountMinor: existing.amountMinor,
          currency: existing.currency,
          createdAt: existing.createdAt,
        };
      }

      await lockRows(tx, "Account", [input.sourceAccountId, input.destinationAccountId]);

      const [sourceAccount, destinationAccount] = await Promise.all([
        tx.account.findFirst({
          where: {
            id: input.sourceAccountId,
            userId: input.initiatorId,
            isSystem: false,
          },
        }),
        tx.account.findFirst({
          where: {
            id: input.destinationAccountId,
            isSystem: false,
          },
        }),
      ]);

      if (!sourceAccount || !destinationAccount) {
        throw new AppError("ACCOUNT_NOT_FOUND", "The selected account could not be found.", 404);
      }

      if (
        sourceAccount.status !== AccountStatus.ACTIVE ||
        destinationAccount.status !== AccountStatus.ACTIVE
      ) {
        throw new AppError("ACCOUNT_RESTRICTED", "One of the selected accounts is not active.", 409);
      }

      if (sourceAccount.currency !== currency || destinationAccount.currency !== currency) {
        throw new AppError("CURRENCY_MISMATCH", "Transfers require accounts in the same currency.", 422);
      }

      await assertTransferWithinPolicy(tx, {
        userId: input.initiatorId,
        currency,
        amountMinor: input.amountMinor,
      });

      if (sourceAccount.availableBalanceMinor < input.amountMinor) {
        throw new AppError("INSUFFICIENT_FUNDS", "Your available balance is too low for this transfer.", 409);
      }

      const journal = await tx.journal.create({
        data: {
          reference: reference("TRF"),
          status: JournalStatus.PENDING,
          narration: input.memo || "Internal account transfer",
          currency,
          metadata: {
            operation: "internal_transfer",
          },
        },
      });

      const transfer = await tx.transfer.create({
        data: {
          initiatorId: input.initiatorId,
          sourceAccountId: sourceAccount.id,
          destinationAccountId: destinationAccount.id,
          journalId: journal.id,
          idempotencyKey: input.idempotencyKey,
          amountMinor: input.amountMinor,
          currency,
          memo: input.memo,
          status: TransferStatus.PENDING,
        },
      });

      const [updatedSource, updatedDestination] = await Promise.all([
        tx.account.update({
          where: { id: sourceAccount.id },
          data: {
            availableBalanceMinor: { decrement: input.amountMinor },
            ledgerBalanceMinor: { decrement: input.amountMinor },
          },
        }),
        tx.account.update({
          where: { id: destinationAccount.id },
          data: {
            availableBalanceMinor: { increment: input.amountMinor },
            ledgerBalanceMinor: { increment: input.amountMinor },
          },
        }),
      ]);

      await tx.ledgerEntry.createMany({
        data: [
          {
            journalId: journal.id,
            accountId: sourceAccount.id,
            direction: EntryDirection.DEBIT,
            amountMinor: input.amountMinor,
            currency,
            balanceAfterMinor: updatedSource.ledgerBalanceMinor,
          },
          {
            journalId: journal.id,
            accountId: destinationAccount.id,
            direction: EntryDirection.CREDIT,
            amountMinor: input.amountMinor,
            currency,
            balanceAfterMinor: updatedDestination.ledgerBalanceMinor,
          },
        ],
      });

      const postedAt = new Date();
      await tx.journal.update({
        where: { id: journal.id },
        data: {
          status: JournalStatus.POSTED,
          postedAt,
        },
      });
      const postedTransfer = await tx.transfer.update({
        where: { id: transfer.id },
        data: {
          status: TransferStatus.POSTED,
          postedAt,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: input.initiatorId,
          action: "TRANSFER_POSTED",
          resource: "Transfer",
          resourceId: transfer.id,
          outcome: "SUCCESS",
          metadata: {
            sourceAccountId: sourceAccount.id,
            destinationAccountId: destinationAccount.id,
            amountMinor: input.amountMinor.toString(),
            currency,
          },
        },
      });

      return {
        id: postedTransfer.id,
        status: postedTransfer.status,
        amountMinor: postedTransfer.amountMinor,
        currency: postedTransfer.currency,
        createdAt: postedTransfer.createdAt,
      };
    },
  );
}

export async function settleFundingIntent(input: {
  paymentIntentId: string;
  settlementReference: string;
  allowManualReview?: boolean;
  allowExpired?: boolean;
  actorId?: string;
  reviewId?: string;
}): Promise<{
  paymentIntentId: string;
  alreadySettled: boolean;
  manualReview: boolean;
}> {
  return serializableWithRetry(
    async (tx) => {
      await lockRows(tx, "PaymentIntent", [input.paymentIntentId]);
      const intent = await tx.paymentIntent.findUnique({
        where: { id: input.paymentIntentId },
      });

      if (!intent) {
        throw new AppError("PAYMENT_INTENT_NOT_FOUND", "Payment intent was not found.", 404);
      }

      if (intent.status === "SUCCEEDED") {
        if (
          input.settlementReference &&
          intent.settlementReference &&
          input.settlementReference !== intent.settlementReference
        ) {
          throw new AppError(
            "SETTLEMENT_REFERENCE_CONFLICT",
            "This payment was already settled with a different reference.",
            409,
          );
        }
        return {
          paymentIntentId: intent.id,
          alreadySettled: true,
          manualReview: false,
        };
      }

      const expired = Boolean(intent.expiresAt && intent.expiresAt <= new Date());
      if (expired && !input.allowExpired) {
        await tx.paymentIntent.update({
          where: { id: intent.id },
          data: {
            status: "MANUAL_REVIEW",
            failureCode: "LATE_SETTLEMENT_EVIDENCE",
          },
        });
        await tx.auditLog.create({
          data: {
            action: "PAYMENT_LATE_SETTLEMENT_REVIEW",
            resource: "PaymentIntent",
            resourceId: intent.id,
            outcome: "DENIED",
            metadata: {
              provider: intent.provider,
              userId: intent.userId,
            },
          },
        });
        return {
          paymentIntentId: intent.id,
          alreadySettled: false,
          manualReview: true,
        };
      }

      if (intent.status === "MANUAL_REVIEW" && !input.allowManualReview) {
        return {
          paymentIntentId: intent.id,
          alreadySettled: false,
          manualReview: true,
        };
      }

      if (
        ["CANCELLED", "FAILED", "CREATED"].includes(intent.status) ||
        (intent.status === "EXPIRED" && !input.allowExpired)
      ) {
        throw new AppError("PAYMENT_NOT_SETTLEABLE", "This payment cannot be settled.", 409);
      }

      const clearing = await ensureClearingAccount(tx, intent.currency);
      await lockRows(tx, "Account", [clearing.id, intent.accountId]);
      const targetAccount = await tx.account.findUnique({
        where: { id: intent.accountId },
      });
      if (!targetAccount || targetAccount.status !== AccountStatus.ACTIVE) {
        throw new AppError("ACCOUNT_RESTRICTED", "The destination account is not active.", 409);
      }

      const journal = await tx.journal.create({
        data: {
          reference: reference("FND"),
          status: JournalStatus.PENDING,
          narration: "Confirmed " + intent.method + " funding",
          currency: intent.currency,
          externalReference: intent.provider + ":" + input.settlementReference,
          metadata: {
            operation: "funding_settlement",
            paymentIntentId: intent.id,
            provider: intent.provider,
          },
        },
      });

      const [updatedClearing, updatedTarget] = await Promise.all([
        tx.account.update({
          where: { id: clearing.id },
          data: {
            availableBalanceMinor: { increment: intent.amountMinor },
            ledgerBalanceMinor: { increment: intent.amountMinor },
          },
        }),
        tx.account.update({
          where: { id: targetAccount.id },
          data: {
            availableBalanceMinor: { increment: intent.amountMinor },
            ledgerBalanceMinor: { increment: intent.amountMinor },
          },
        }),
      ]);

      await tx.ledgerEntry.createMany({
        data: [
          {
            journalId: journal.id,
            accountId: clearing.id,
            direction: EntryDirection.DEBIT,
            amountMinor: intent.amountMinor,
            currency: intent.currency,
            balanceAfterMinor: updatedClearing.ledgerBalanceMinor,
          },
          {
            journalId: journal.id,
            accountId: targetAccount.id,
            direction: EntryDirection.CREDIT,
            amountMinor: intent.amountMinor,
            currency: intent.currency,
            balanceAfterMinor: updatedTarget.ledgerBalanceMinor,
          },
        ],
      });

      const completedAt = new Date();
      await tx.journal.update({
        where: { id: journal.id },
        data: {
          status: JournalStatus.POSTED,
          postedAt: completedAt,
        },
      });
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: "SUCCEEDED",
          journalId: journal.id,
          settlementReference: input.settlementReference,
          completedAt,
          failureCode: null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "PAYMENT_SETTLED",
          resource: "PaymentIntent",
          resourceId: intent.id,
          outcome: "SUCCESS",
          metadata: {
            provider: intent.provider,
            userId: intent.userId,
            settlementReviewId: input.reviewId ?? null,
            amountMinor: intent.amountMinor.toString(),
            currency: intent.currency,
          },
        },
      });

      return {
        paymentIntentId: intent.id,
        alreadySettled: false,
        manualReview: false,
      };
    },
  );
}
