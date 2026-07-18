import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AccountKind,
  AccountStatus,
  KycStatus,
  LedgerAccountClass,
  PaymentIntentStatus,
  PaymentMethod,
  Provider,
  UserRole,
  UserStatus,
} from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { postInternalTransfer, settleFundingIntent } from "@/lib/domain/ledger";
import { resetEnvironmentForTests } from "@/lib/env";
import {
  confirmMfaEnrollment,
  startMfaEnrollment,
  verifyMfaFactor,
} from "@/lib/mfa/totp";
import {
  approveSettlementReview,
  requestSettlementReview,
} from "@/lib/operations/settlement-review";
import {
  beginWebhook,
  completeWebhook,
  failWebhook,
} from "@/lib/webhooks/store";
import { Secret, TOTP } from "otpauth";

let accountSequence = 0;

async function resetDatabase(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.includes("banknow_test")) {
    throw new Error("Integration tests refuse to truncate a database not named banknow_test.");
  }
  await getDb().$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditLog", "ProviderWebhook", "RateLimitBucket", "TransactionPolicy", "SettlementReview",
      "LedgerEntry", "Transfer", "PaymentIntent", "Journal", "Account",
      "MfaRecoveryCode", "MfaChallenge", "MfaFactor", "Session",
      "PasswordResetToken", "EmailVerificationToken", "KycProfile", "User"
    RESTART IDENTITY CASCADE
  `);
}

async function createCustomer(label: string) {
  accountSequence += 1;
  const user = await getDb().user.create({
    data: {
      email: label + "-" + randomUUID() + "@banknow.test",
      firstName: label,
      lastName: "Customer",
      passwordHash: "integration-test-hash",
      status: UserStatus.ACTIVE,
      kycStatus: KycStatus.VERIFIED,
      emailVerifiedAt: new Date(),
    },
  });
  const account = await getDb().account.create({
    data: {
      userId: user.id,
      accountNumber: (8800000000000n + BigInt(accountSequence)).toString(),
      displayName: label + " Wallet",
      currency: "KES",
      kind: AccountKind.WALLET,
      ledgerClass: LedgerAccountClass.LIABILITY,
      status: AccountStatus.ACTIVE,
    },
  });
  return { user, account };
}

async function enableTransferPolicy(): Promise<void> {
  await getDb().transactionPolicy.create({
    data: {
      currency: "KES",
      enabled: true,
      maximumAmountMinor: 1_000_000n,
      rolling24HourAmountLimitMinor: 2_000_000n,
      rolling24HourCountLimit: 20,
    },
  });
}

async function createFinanceOperator(label: string) {
  return getDb().user.create({
    data: {
      email: label + "-" + randomUUID() + "@banknow.test",
      firstName: label,
      lastName: "Operator",
      passwordHash: "integration-test-hash",
      role: UserRole.FINANCE_ADMIN,
      status: UserStatus.ACTIVE,
      kycStatus: KycStatus.VERIFIED,
      emailVerifiedAt: new Date(),
    },
  });
}

async function fundAccount(userId: string, accountId: string, amountMinor: bigint) {
  const intent = await getDb().paymentIntent.create({
    data: {
      userId,
      accountId,
      provider: Provider.BANK_TRANSFER,
      method: PaymentMethod.BANK_TRANSFER,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID().replaceAll("-", ""),
      amountMinor,
      currency: "KES",
      status: PaymentIntentStatus.PENDING,
      providerReference: "BNK-" + randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return settleFundingIntent({
    paymentIntentId: intent.id,
    settlementReference: "SETTLEMENT-" + randomUUID(),
  });
}

beforeAll(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv(
    "SESSION_PEPPER",
    "integration-session-pepper-with-at-least-thirty-two-characters",
  );
  vi.stubEnv("FIELD_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
  resetEnvironmentForTests();
});

beforeEach(resetDatabase);

afterAll(async () => {
  await getDb().$disconnect();
});

describe("banking core database boundaries", () => {
  it("posts an exactly-once balanced transfer and rejects idempotency-key payload changes", async () => {
    const source = await createCustomer("Source");
    const destination = await createCustomer("Destination");
    await enableTransferPolicy();
    await fundAccount(source.user.id, source.account.id, 50_000n);
    const idempotencyKey = randomUUID();
    const request = {
      initiatorId: source.user.id,
      sourceAccountId: source.account.id,
      destinationAccountId: destination.account.id,
      amountMinor: 10_000n,
      currency: "KES",
      memo: "Invoice 42",
      idempotencyKey,
    };

    const first = await postInternalTransfer(request);
    const retry = await postInternalTransfer(request);
    expect(retry.id).toBe(first.id);
    await expect(
      postInternalTransfer({ ...request, amountMinor: 11_000n }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const [sourceAfter, destinationAfter, entries] = await Promise.all([
      getDb().account.findUniqueOrThrow({ where: { id: source.account.id } }),
      getDb().account.findUniqueOrThrow({ where: { id: destination.account.id } }),
      getDb().ledgerEntry.findMany({ where: { journal: { transfer: { id: first.id } } } }),
    ]);
    expect(sourceAfter.availableBalanceMinor).toBe(40_000n);
    expect(destinationAfter.availableBalanceMinor).toBe(10_000n);
    expect(entries).toHaveLength(2);
    expect(
      entries.filter((entry) => entry.direction === "DEBIT")[0]?.amountMinor,
    ).toBe(10_000n);
    expect(
      entries.filter((entry) => entry.direction === "CREDIT")[0]?.amountMinor,
    ).toBe(10_000n);
  });

  it("prevents concurrent transfers from overdrawing an account", async () => {
    const source = await createCustomer("ConcurrentSource");
    const destinationOne = await createCustomer("DestinationOne");
    const destinationTwo = await createCustomer("DestinationTwo");
    await enableTransferPolicy();
    await fundAccount(source.user.id, source.account.id, 15_000n);
    const transfer = (destinationAccountId: string) =>
      postInternalTransfer({
        initiatorId: source.user.id,
        sourceAccountId: source.account.id,
        destinationAccountId,
        amountMinor: 10_000n,
        currency: "KES",
        idempotencyKey: randomUUID(),
      });

    const results = await Promise.allSettled([
      transfer(destinationOne.account.id),
      transfer(destinationTwo.account.id),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const sourceAfter = await getDb().account.findUniqueOrThrow({
      where: { id: source.account.id },
    });
    expect(sourceAfter.availableBalanceMinor).toBe(5_000n);
  });

  it("settles concurrent provider evidence once and keeps ledger entries immutable", async () => {
    const customer = await createCustomer("Funding");
    const intent = await getDb().paymentIntent.create({
      data: {
        userId: customer.user.id,
        accountId: customer.account.id,
        provider: Provider.STRIPE,
        method: PaymentMethod.CARD,
        idempotencyKey: randomUUID(),
        requestHash: randomUUID().replaceAll("-", ""),
        amountMinor: 25_000n,
        currency: "KES",
        status: PaymentIntentStatus.REQUIRES_ACTION,
        providerReference: "cs_" + randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const settle = () =>
      settleFundingIntent({
        paymentIntentId: intent.id,
        settlementReference: intent.providerReference!,
      });
    const results = await Promise.all([settle(), settle()]);
    expect(results.filter((result) => result.alreadySettled)).toHaveLength(1);

    const completed = await getDb().paymentIntent.findUniqueOrThrow({
      where: { id: intent.id },
      include: { journal: { include: { entries: true } } },
    });
    expect(completed.journal?.entries).toHaveLength(2);
    const account = await getDb().account.findUniqueOrThrow({
      where: { id: customer.account.id },
    });
    expect(account.ledgerBalanceMinor).toBe(25_000n);
    await expect(
      getDb().ledgerEntry.update({
        where: { id: completed.journal!.entries[0]!.id },
        data: { amountMinor: 1n },
      }),
    ).rejects.toThrow();
  });

  it("reclaims failed webhooks but keeps completed events terminal", async () => {
    const first = await beginWebhook({
      provider: Provider.STRIPE,
      externalEventId: "evt_retry_test",
      rawPayload: "{\"id\":\"evt_retry_test\"}",
      signatureValid: true,
    });
    expect(first.disposition).toBe("claimed");
    await failWebhook(first.id, "temporary database outage");

    const retry = await beginWebhook({
      provider: Provider.STRIPE,
      externalEventId: "evt_retry_test",
      rawPayload: "{\"id\":\"evt_retry_test\"}",
      signatureValid: true,
    });
    expect(retry.disposition).toBe("claimed");
    await completeWebhook(retry.id);
    const terminal = await beginWebhook({
      provider: Provider.STRIPE,
      externalEventId: "evt_retry_test",
      rawPayload: "{\"id\":\"evt_retry_test\"}",
      signatureValid: true,
    });
    expect(terminal.disposition).toBe("processed");
    const stored = await getDb().providerWebhook.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(stored.attemptCount).toBe(2);
  });

  it("fails closed when an operator has not enabled transaction limits", async () => {
    const source = await createCustomer("NoPolicySource");
    const destination = await createCustomer("NoPolicyDestination");
    await fundAccount(source.user.id, source.account.id, 10_000n);
    await expect(
      postInternalTransfer({
        initiatorId: source.user.id,
        sourceAccountId: source.account.id,
        destinationAccountId: destination.account.id,
        amountMinor: 1_000n,
        currency: "KES",
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "TRANSFER_POLICY_UNAVAILABLE" });
  });

  it("rejects unbalanced journals at posting time", async () => {
    const customer = await createCustomer("Unbalanced");
    const journal = await getDb().journal.create({
      data: {
        reference: "BAD-" + randomUUID(),
        narration: "Deliberately unbalanced integration test",
        currency: "KES",
      },
    });
    await getDb().ledgerEntry.create({
      data: {
        journalId: journal.id,
        accountId: customer.account.id,
        direction: "CREDIT",
        amountMinor: 100n,
        currency: "KES",
      },
    });
    await expect(
      getDb().journal.update({
        where: { id: journal.id },
        data: { status: "POSTED", postedAt: new Date() },
      }),
    ).rejects.toThrow();
  });

  it("prevents TOTP replay and atomically consumes a recovery code", async () => {
    const customer = await createCustomer("MfaReplay");
    const enrollment = await startMfaEnrollment({
      id: customer.user.id,
      email: customer.user.email,
    });
    const totp = new TOTP({
      secret: Secret.fromBase32(enrollment.manualSecret),
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
    const code = totp.generate();
    await confirmMfaEnrollment({
      userId: customer.user.id,
      email: customer.user.email,
      code,
    });
    await expect(
      verifyMfaFactor({
        userId: customer.user.id,
        email: customer.user.email,
        code,
      }),
    ).rejects.toMatchObject({ code: "MFA_CODE_REPLAYED" });

    const recoveryCode = enrollment.recoveryCodes[0]!;
    const attempts = await Promise.allSettled([
      verifyMfaFactor({
        userId: customer.user.id,
        email: customer.user.email,
        code: recoveryCode,
      }),
      verifyMfaFactor({
        userId: customer.user.id,
        email: customer.user.email,
        code: recoveryCode,
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
  });

  it("requires a different finance operator before manual settlement executes", async () => {
    const customer = await createCustomer("ReviewedFunding");
    const maker = await createFinanceOperator("Maker");
    const checker = await createFinanceOperator("Checker");
    const intent = await getDb().paymentIntent.create({
      data: {
        userId: customer.user.id,
        accountId: customer.account.id,
        provider: Provider.BANK_TRANSFER,
        method: PaymentMethod.BANK_TRANSFER,
        idempotencyKey: randomUUID(),
        requestHash: randomUUID().replaceAll("-", ""),
        amountMinor: 30_000n,
        currency: "KES",
        status: PaymentIntentStatus.PENDING,
        providerReference: "BNK-" + randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const review = await requestSettlementReview({
      paymentIntentId: intent.id,
      requestedById: maker.id,
      idempotencyKey: randomUUID(),
      settlementReference: "BANK-STATEMENT-" + randomUUID(),
      evidenceReference: "s3://finance-evidence/" + randomUUID(),
      reason: "Incoming bank statement and sponsor-bank reference matched.",
    });
    await expect(
      approveSettlementReview({ reviewId: review.id, actorId: maker.id }),
    ).rejects.toMatchObject({ code: "SEGREGATION_OF_DUTIES_REQUIRED" });

    const executed = await approveSettlementReview({
      reviewId: review.id,
      actorId: checker.id,
    });
    expect(executed.status).toBe("EXECUTED");
    const account = await getDb().account.findUniqueOrThrow({
      where: { id: customer.account.id },
    });
    expect(account.availableBalanceMinor).toBe(30_000n);
    const retry = await approveSettlementReview({
      reviewId: review.id,
      actorId: checker.id,
    });
    expect(retry.status).toBe("EXECUTED");
  });
});
