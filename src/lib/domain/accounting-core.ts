import { createHash, randomUUID } from "node:crypto";

import {
  AccountStatus,
  EntryDirection,
  HoldStatus,
  JournalStatus,
  Prisma,
} from "@/generated/prisma/client";
import type {
  PaymentInstructionStatus,
  PricingCalculationType,
} from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";

type Tx = Prisma.TransactionClient;

const transitions: Record<PaymentInstructionStatus, ReadonlySet<PaymentInstructionStatus>> = {
  RECEIVED: new Set(["SCREENING", "CANCELLED", "REJECTED"]),
  SCREENING: new Set(["AUTHORIZED", "REJECTED", "CANCELLED"]),
  AUTHORIZED: new Set(["FUNDS_HELD", "SUBMITTED", "CANCELLED", "REJECTED"]),
  FUNDS_HELD: new Set(["SUBMITTED", "CANCELLED", "REJECTED"]),
  SUBMITTED: new Set(["ACCEPTED", "SETTLED", "REJECTED", "RETURNED"]),
  ACCEPTED: new Set(["SETTLED", "REJECTED", "RETURNED"]),
  SETTLED: new Set(["RETURNED"]),
  REJECTED: new Set(),
  RETURNED: new Set(),
  CANCELLED: new Set(),
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function reference(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll("-", "").toUpperCase()}`;
}

async function lock(tx: Tx, table: "Account" | "FundsHold" | "Journal" | "PaymentInstruction" | "FxQuote", ids: string[]) {
  const ordered = [...new Set(ids)].sort();
  if (ordered.length === 0) return;
  const placeholders = ordered.map((_, index) => `$${index + 1}`).join(",");
  await tx.$executeRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" IN (${placeholders}) ORDER BY "id" FOR UPDATE`, ...ordered);
}

export async function serializable<T>(operation: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await getDb().$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || error.code === "P2002" || error.code === "P2010");
      if (!retryable || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt + Math.floor(Math.random() * 25)));
    }
  }
  throw new Error("Transaction retry exhausted.");
}

export async function requireCurrency(tx: Tx, code: string, settlement = false) {
  const normalized = code.trim().toUpperCase();
  const currency = await tx.currencyDefinition.findUnique({ where: { code: normalized } });
  if (!currency?.enabled || (settlement && !currency.settlementEnabled)) {
    throw new AppError("UNSUPPORTED_CURRENCY", `Currency ${normalized} is not enabled for this operation.`, 422);
  }
  return currency;
}

export async function requireOpenAccountingPeriod(tx: Tx, at = new Date()) {
  const periods = await tx.accountingPeriod.findMany({ where: { status: "OPEN", startsAt: { lte: at }, endsAt: { gt: at } }, take: 2 });
  if (periods.length !== 1) throw new AppError("ACCOUNTING_PERIOD_UNAVAILABLE", "Exactly one open accounting period is required.", 503);
  return periods[0];
}

export async function openAccountingPeriod(input: { code: string; startsAt: Date; endsAt: Date; actorId: string }) {
  if (input.endsAt <= input.startsAt) throw new AppError("INVALID_PERIOD", "Accounting period end must follow its start.", 422);
  return serializable(async (tx) => {
    const overlaps = await tx.accountingPeriod.count({ where: { startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt }, status: { in: ["OPEN", "CLOSING"] } } });
    if (overlaps) throw new AppError("PERIOD_OVERLAP", "An open or closing period overlaps this range.", 409);
    const period = await tx.accountingPeriod.create({ data: { code: input.code, startsAt: input.startsAt, endsAt: input.endsAt } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "ACCOUNTING_PERIOD_OPENED", resource: "AccountingPeriod", resourceId: period.id, outcome: "SUCCESS", metadata: { code: period.code, startsAt: period.startsAt.toISOString(), endsAt: period.endsAt.toISOString() } } });
    return period;
  });
}

export async function configureCurrency(input: { code: string; exponent: number; name: string; enabled: boolean; settlementEnabled: boolean; actorId: string }) {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || !Number.isInteger(input.exponent) || input.exponent < 0 || input.exponent > 6 || (input.settlementEnabled && !input.enabled)) throw new AppError("INVALID_CURRENCY_CONFIGURATION", "Currency configuration is invalid.", 422);
  return serializable(async (tx) => {
    const currency = await tx.currencyDefinition.upsert({ where: { code }, create: { code, exponent: input.exponent, name: input.name, enabled: input.enabled, settlementEnabled: input.settlementEnabled }, update: { exponent: input.exponent, name: input.name, enabled: input.enabled, settlementEnabled: input.settlementEnabled } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "CURRENCY_CONFIGURED", resource: "CurrencyDefinition", resourceId: code, outcome: "SUCCESS", metadata: { exponent: input.exponent, enabled: input.enabled, settlementEnabled: input.settlementEnabled } } });
    return currency;
  });
}

export async function configureGlAccount(input: { code: string; name: string; ledgerClass: "ASSET" | "LIABILITY" | "REVENUE" | "EXPENSE" | "EQUITY"; currency?: string; allowManualPosting: boolean; effectiveFrom: Date; effectiveTo?: Date; actorId: string }) {
  if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom) throw new AppError("INVALID_GL_EFFECTIVITY", "GL effective range is invalid.", 422);
  const normalDirection = input.ledgerClass === "ASSET" || input.ledgerClass === "EXPENSE" ? "DEBIT" : "CREDIT";
  return serializable(async (tx) => {
    if (input.currency) await requireCurrency(tx, input.currency);
    const gl = await tx.glAccount.create({ data: { code: input.code, name: input.name, ledgerClass: input.ledgerClass, normalDirection, currency: input.currency, allowManualPosting: input.allowManualPosting, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "GL_ACCOUNT_CONFIGURED", resource: "GlAccount", resourceId: gl.id, outcome: "SUCCESS", metadata: { code: gl.code, ledgerClass: gl.ledgerClass } } });
    return gl;
  });
}

export async function parseConfiguredAmount(value: string, currencyCode: string): Promise<bigint> {
  const currency = await getDb().currencyDefinition.findUnique({ where: { code: currencyCode.trim().toUpperCase() } });
  if (!currency?.enabled) throw new AppError("UNSUPPORTED_CURRENCY", "Currency is not enabled.", 422);
  const expression = currency.exponent === 0 ? /^(0|[1-9]\d*)$/ : new RegExp(`^(0|[1-9]\\d*)(\\.\\d{1,${currency.exponent}})?$`);
  if (!expression.test(value.trim())) throw new AppError("INVALID_AMOUNT", `Amount must have at most ${currency.exponent} fractional digits.`, 422);
  const [whole, fraction = ""] = value.trim().split(".");
  const result = BigInt(whole) * 10n ** BigInt(currency.exponent) + BigInt(fraction.padEnd(currency.exponent, "0") || "0");
  if (result <= 0n) throw new AppError("INVALID_AMOUNT", "Amount must be greater than zero.", 422);
  return result;
}

export async function createFundsHold(input: { accountId: string; amountMinor: bigint; currency: string; externalReference: string; idempotencyKey: string; expiresAt: Date }) {
  if (input.amountMinor <= 0n || input.expiresAt <= new Date()) throw new AppError("INVALID_HOLD", "Hold amount and expiry are invalid.", 422);
  const requestHash = hash({ ...input, amountMinor: input.amountMinor.toString(), expiresAt: input.expiresAt.toISOString() });
  return serializable(async (tx) => {
    const existing = await tx.fundsHold.findUnique({ where: { accountId_idempotencyKey: { accountId: input.accountId, idempotencyKey: input.idempotencyKey } } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new AppError("IDEMPOTENCY_CONFLICT", "Hold idempotency key has different parameters.", 409);
      return existing;
    }
    await requireCurrency(tx, input.currency);
    await lock(tx, "Account", [input.accountId]);
    const account = await tx.account.findUnique({ where: { id: input.accountId } });
    if (!account || account.status !== AccountStatus.ACTIVE || account.currency !== input.currency || account.availableBalanceMinor < input.amountMinor) {
      throw new AppError("HOLD_NOT_ALLOWED", "Account cannot support this hold.", 409);
    }
    await tx.account.update({ where: { id: account.id }, data: { availableBalanceMinor: { decrement: input.amountMinor }, heldBalanceMinor: { increment: input.amountMinor } } });
    const hold = await tx.fundsHold.create({ data: { ...input, requestHash } });
    await tx.auditLog.create({ data: { action: "FUNDS_HELD", resource: "FundsHold", resourceId: hold.id, outcome: "SUCCESS", metadata: { accountId: account.id, amountMinor: input.amountMinor.toString(), currency: input.currency } } });
    return hold;
  });
}

export async function releaseFundsHold(input: { holdId: string; reason: string; actorId?: string }) {
  return serializable(async (tx) => {
    await lock(tx, "FundsHold", [input.holdId]);
    const hold = await tx.fundsHold.findUnique({ where: { id: input.holdId } });
    if (!hold) throw new AppError("HOLD_NOT_FOUND", "Funds hold was not found.", 404);
    if (hold.status === HoldStatus.RELEASED || hold.status === HoldStatus.EXPIRED) return hold;
    if (hold.status === HoldStatus.CAPTURED) throw new AppError("HOLD_CAPTURED", "Captured hold cannot be released.", 409);
    await lock(tx, "Account", [hold.accountId]);
    const remaining = hold.amountMinor - hold.capturedAmountMinor;
    await tx.account.update({ where: { id: hold.accountId }, data: { availableBalanceMinor: { increment: remaining }, heldBalanceMinor: { decrement: remaining } } });
    const released = await tx.fundsHold.update({ where: { id: hold.id }, data: { status: HoldStatus.RELEASED, releasedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "FUNDS_HOLD_RELEASED", resource: "FundsHold", resourceId: hold.id, outcome: "SUCCESS", metadata: { reason: input.reason, releasedMinor: remaining.toString() } } });
    return released;
  });
}

export async function captureFundsHold(input: { holdId: string; destinationAccountId: string; amountMinor: bigint; idempotencyKey: string; actorId?: string }) {
  if (input.amountMinor <= 0n) throw new AppError("INVALID_AMOUNT", "Capture amount must be positive.", 422);
  return serializable(async (tx) => {
    await lock(tx, "FundsHold", [input.holdId]);
    const existingCapture = await tx.fundsHoldCapture.findUnique({ where: { holdId_idempotencyKey: { holdId: input.holdId, idempotencyKey: input.idempotencyKey } }, include: { hold: true } });
    if (existingCapture) {
      if (existingCapture.amountMinor !== input.amountMinor) throw new AppError("IDEMPOTENCY_CONFLICT", "Capture key has a different amount.", 409);
      return existingCapture.hold;
    }
    const hold = await tx.fundsHold.findUnique({ where: { id: input.holdId } });
    if (!hold || (hold.status !== HoldStatus.ACTIVE && hold.status !== HoldStatus.PARTIALLY_CAPTURED)) throw new AppError("HOLD_NOT_CAPTURABLE", "Hold is not capturable.", 409);
    const remaining = hold.amountMinor - hold.capturedAmountMinor;
    if (hold.expiresAt <= new Date() || input.amountMinor > remaining) throw new AppError("HOLD_CAPTURE_INVALID", "Hold is expired or capture exceeds remaining funds.", 409);
    await lock(tx, "Account", [hold.accountId, input.destinationAccountId]);
    const [source, destination] = await Promise.all([tx.account.findUnique({ where: { id: hold.accountId } }), tx.account.findUnique({ where: { id: input.destinationAccountId } })]);
    if (!source || !destination || destination.status !== AccountStatus.ACTIVE || source.currency !== destination.currency || source.currency !== hold.currency) throw new AppError("ACCOUNT_RESTRICTED", "Capture accounts are incompatible.", 409);
    const period = await requireOpenAccountingPeriod(tx);
    const journal = await tx.journal.create({ data: { reference: reference("HLD"), narration: "Funds hold capture", currency: hold.currency, accountingPeriodId: period.id } });
    const [sourceAfter, destinationAfter] = await Promise.all([
      tx.account.update({ where: { id: source.id }, data: { heldBalanceMinor: { decrement: input.amountMinor }, ledgerBalanceMinor: { decrement: input.amountMinor } } }),
      tx.account.update({ where: { id: destination.id }, data: { availableBalanceMinor: { increment: input.amountMinor }, ledgerBalanceMinor: { increment: input.amountMinor } } }),
    ]);
    await tx.ledgerEntry.createMany({ data: [
      { journalId: journal.id, accountId: source.id, direction: "DEBIT", amountMinor: input.amountMinor, currency: hold.currency, balanceAfterMinor: sourceAfter.ledgerBalanceMinor },
      { journalId: journal.id, accountId: destination.id, direction: "CREDIT", amountMinor: input.amountMinor, currency: hold.currency, balanceAfterMinor: destinationAfter.ledgerBalanceMinor },
    ] });
    const captured = hold.capturedAmountMinor + input.amountMinor;
    await tx.fundsHoldCapture.create({ data: { holdId: hold.id, journalId: journal.id, idempotencyKey: input.idempotencyKey, amountMinor: input.amountMinor } });
    const updated = await tx.fundsHold.update({ where: { id: hold.id }, data: { capturedAmountMinor: captured, status: captured === hold.amountMinor ? "CAPTURED" : "PARTIALLY_CAPTURED" } });
    await tx.journal.update({ where: { id: journal.id }, data: { status: JournalStatus.POSTED, postedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "FUNDS_HOLD_CAPTURED", resource: "FundsHold", resourceId: hold.id, outcome: "SUCCESS", metadata: { journalId: journal.id, amountMinor: input.amountMinor.toString() } } });
    return updated;
  });
}

export async function reverseJournal(input: { journalId: string; actorId: string; reason: string }) {
  return serializable(async (tx) => {
    await lock(tx, "Journal", [input.journalId]);
    const original = await tx.journal.findUnique({ where: { id: input.journalId }, include: { entries: true, reversalJournal: true, transfer: true, paymentIntent: true } });
    if (!original || original.status !== JournalStatus.POSTED) throw new AppError("JOURNAL_NOT_REVERSIBLE", "Only a posted journal can be reversed.", 409);
    if (original.reversalJournal) return original.reversalJournal;
    await lock(tx, "Account", original.entries.map((entry) => entry.accountId));
    const period = await requireOpenAccountingPeriod(tx);
    const reversal = await tx.journal.create({ data: { reference: reference("REV"), narration: input.reason, currency: original.currency, originalJournalId: original.id, accountingPeriodId: period.id, metadata: { operation: "compensating_reversal", actorId: input.actorId } } });
    for (const entry of original.entries) {
      const direction = entry.direction === EntryDirection.DEBIT ? EntryDirection.CREDIT : EntryDirection.DEBIT;
      const account = await tx.account.findUniqueOrThrow({ where: { id: entry.accountId } });
      const naturalDebit = account.ledgerClass === "ASSET" || account.ledgerClass === "EXPENSE";
      const increases = (naturalDebit && direction === "DEBIT") || (!naturalDebit && direction === "CREDIT");
      const delta = increases ? entry.amountMinor : -entry.amountMinor;
      const after = account.ledgerBalanceMinor + delta;
      const availableAfter = account.availableBalanceMinor + delta;
      if (after < 0n || availableAfter < 0n) throw new AppError("REVERSAL_BALANCE_CONFLICT", "Reversal would violate a non-negative account balance.", 409);
      await tx.account.update({ where: { id: account.id }, data: { ledgerBalanceMinor: after, availableBalanceMinor: availableAfter } });
      await tx.ledgerEntry.create({ data: { journalId: reversal.id, accountId: account.id, direction, amountMinor: entry.amountMinor, currency: entry.currency, balanceAfterMinor: after } });
    }
    await tx.journal.update({ where: { id: reversal.id }, data: { status: "POSTED", postedAt: new Date() } });
    await tx.journal.update({ where: { id: original.id }, data: { status: "REVERSED", reversedAt: new Date() } });
    if (original.transfer) await tx.transfer.update({ where: { id: original.transfer.id }, data: { status: "REVERSED", reversedAt: new Date() } });
    if (original.paymentIntent) await tx.paymentIntent.update({ where: { id: original.paymentIntent.id }, data: { status: "REVERSED" } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "JOURNAL_REVERSED", resource: "Journal", resourceId: original.id, outcome: "SUCCESS", metadata: { reversalJournalId: reversal.id, reason: input.reason } } });
    return reversal;
  });
}

export async function transitionPaymentInstruction(input: { instructionId: string; nextStatus: PaymentInstructionStatus; actorId?: string; providerReference?: string; failureCode?: string }) {
  return serializable(async (tx) => {
    await lock(tx, "PaymentInstruction", [input.instructionId]);
    const instruction = await tx.paymentInstruction.findUnique({ where: { id: input.instructionId } });
    if (!instruction) throw new AppError("INSTRUCTION_NOT_FOUND", "Payment instruction was not found.", 404);
    if (instruction.status === input.nextStatus) return instruction;
    if (!transitions[instruction.status].has(input.nextStatus)) throw new AppError("INVALID_PAYMENT_TRANSITION", `Cannot transition ${instruction.status} to ${input.nextStatus}.`, 409);
    const updated = await tx.paymentInstruction.update({ where: { id: instruction.id }, data: { status: input.nextStatus, providerReference: input.providerReference, failureCode: input.failureCode, settledAt: input.nextStatus === "SETTLED" ? new Date() : undefined } });
    const payload = { instructionId: instruction.id, rail: instruction.rail, from: instruction.status, to: input.nextStatus };
    await tx.outboxMessage.create({ data: { aggregateType: "PaymentInstruction", aggregateId: instruction.id, eventType: `payment.${input.nextStatus.toLowerCase()}`, payload, payloadHash: hash(payload) } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "PAYMENT_INSTRUCTION_TRANSITIONED", resource: "PaymentInstruction", resourceId: instruction.id, outcome: "SUCCESS", metadata: payload } });
    return updated;
  });
}

export async function createPaymentInstruction(input: { initiatorId: string; sourceAccountId?: string; rail: "MPESA" | "PESALINK" | "EFT" | "RTGS" | "SWIFT" | "CARD"; idempotencyKey: string; amountMinor: bigint; currency: string; beneficiary: Prisma.InputJsonValue }) {
  if (input.amountMinor <= 0n) throw new AppError("INVALID_AMOUNT", "Instruction amount must be positive.", 422);
  const requestHash = hash({ ...input, amountMinor: input.amountMinor.toString() });
  return serializable(async (tx) => {
    const existing = await tx.paymentInstruction.findUnique({ where: { initiatorId_idempotencyKey: { initiatorId: input.initiatorId, idempotencyKey: input.idempotencyKey } } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new AppError("IDEMPOTENCY_CONFLICT", "Instruction key has different parameters.", 409);
      return existing;
    }
    await requireCurrency(tx, input.currency, true);
    if (input.sourceAccountId) {
      const source = await tx.account.findUnique({ where: { id: input.sourceAccountId } });
      if (!source || source.status !== "ACTIVE" || source.currency !== input.currency) throw new AppError("ACCOUNT_RESTRICTED", "Instruction source account is invalid.", 409);
    }
    const created = await tx.paymentInstruction.create({ data: { ...input, requestHash } });
    const payload = { instructionId: created.id, rail: created.rail, status: created.status };
    await tx.outboxMessage.create({ data: { aggregateType: "PaymentInstruction", aggregateId: created.id, eventType: "payment.received", payload, payloadHash: hash(payload) } });
    return created;
  });
}

export async function receiveInbox(input: { source: string; externalId: string; eventType: string; payloadHash: string; encryptedPayload?: string }) {
  return serializable(async (tx) => {
    const existing = await tx.inboxMessage.findUnique({ where: { source_externalId: { source: input.source, externalId: input.externalId } } });
    if (existing) {
      if (existing.payloadHash !== input.payloadHash) throw new AppError("INBOX_PAYLOAD_CONFLICT", "External message identifier was reused with different content.", 409);
      return existing;
    }
    return tx.inboxMessage.create({ data: input });
  });
}

export async function completeOutbox(input: { messageId: string; workerId: string; error?: string }) {
  const message = await getDb().outboxMessage.findFirst({ where: { id: input.messageId, status: "PROCESSING", leaseOwner: input.workerId, leaseExpiresAt: { gt: new Date() } } });
  if (!message) throw new AppError("OUTBOX_LEASE_LOST", "Outbox lease is missing or expired.", 409);
  const dead = Boolean(input.error && message.attemptCount >= 10);
  return getDb().outboxMessage.update({ where: { id: message.id }, data: input.error ? { status: dead ? "DEAD_LETTER" : "FAILED", lastError: input.error, availableAt: new Date(Date.now() + Math.min(3_600_000, 1_000 * 2 ** message.attemptCount)), leaseOwner: null, leaseExpiresAt: null } : { status: "PROCESSED", processedAt: new Date(), lastError: null, leaseOwner: null, leaseExpiresAt: null } });
}

export async function claimOutbox(workerId: string, limit = 100, leaseSeconds = 60) {
  if (limit < 1 || limit > 500) throw new AppError("INVALID_BATCH_SIZE", "Outbox batch must be between 1 and 500.", 422);
  return getDb().$queryRaw<Array<{ id: string; eventType: string; payload: Prisma.JsonValue }>>(Prisma.sql`
    UPDATE "OutboxMessage" SET "status" = 'PROCESSING', "leaseOwner" = ${workerId},
      "leaseExpiresAt" = NOW() + (${leaseSeconds} * INTERVAL '1 second'), "attemptCount" = "attemptCount" + 1
    WHERE "id" IN (SELECT "id" FROM "OutboxMessage" WHERE "availableAt" <= NOW()
      AND ("status" IN ('PENDING','FAILED') OR ("status"='PROCESSING' AND "leaseExpiresAt" < NOW()))
      ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT ${limit})
    RETURNING "id", "eventType", "payload"
  `);
}

export function calculatePricing(rule: { calculationType: PricingCalculationType; flatAmountMinor: bigint | null; basisPoints: number | null; minimumMinor: bigint | null; maximumMinor: bigint | null }, baseMinor: bigint): bigint {
  if (baseMinor <= 0n) throw new AppError("INVALID_PRICING_BASE", "Pricing base must be positive.", 422);
  let amount = rule.calculationType === "FLAT" ? rule.flatAmountMinor : rule.basisPoints === null ? null : (baseMinor * BigInt(rule.basisPoints) + 9_999n) / 10_000n;
  if (amount === null || amount < 0n) throw new AppError("INVALID_PRICING_RULE", "Pricing rule is incomplete.", 409);
  if (rule.minimumMinor !== null && amount < rule.minimumMinor) amount = rule.minimumMinor;
  if (rule.maximumMinor !== null && amount > rule.maximumMinor) amount = rule.maximumMinor;
  return amount;
}

export async function createAccrual(input: { accountId: string; pricingRuleId: string; accrualDate: Date; baseMinor: bigint }) {
  return serializable(async (tx) => {
    const existing = await tx.accrual.findUnique({ where: { accountId_pricingRuleId_accrualDate: { accountId: input.accountId, pricingRuleId: input.pricingRuleId, accrualDate: input.accrualDate } } });
    if (existing) return existing;
    const [account, rule] = await Promise.all([tx.account.findUnique({ where: { id: input.accountId } }), tx.pricingRule.findUnique({ where: { id: input.pricingRuleId } })]);
    const now = new Date();
    if (!account || !rule || !rule.active || rule.currency !== account.currency || rule.componentType !== "INTEREST" || rule.effectiveFrom > now || (rule.effectiveTo && rule.effectiveTo <= now)) throw new AppError("ACCRUAL_RULE_INVALID", "No effective interest rule applies.", 409);
    const amountMinor = calculatePricing(rule, input.baseMinor);
    return tx.accrual.create({ data: { accountId: account.id, pricingRuleId: rule.id, accrualDate: input.accrualDate, amountMinor, currency: account.currency } });
  });
}

export async function postPricingCharge(input: { accountId: string; pricingRuleId: string; baseMinor: bigint; actorId?: string }) {
  return serializable(async (tx) => {
    const [account, rule, period] = await Promise.all([tx.account.findUnique({ where: { id: input.accountId } }), tx.pricingRule.findUnique({ where: { id: input.pricingRuleId } }), requireOpenAccountingPeriod(tx)]);
    const now = new Date();
    if (!account || !rule || !rule.active || rule.currency !== account.currency || rule.effectiveFrom > now || (rule.effectiveTo && rule.effectiveTo <= now)) throw new AppError("PRICING_RULE_INVALID", "No effective pricing rule applies.", 409);
    const amount = calculatePricing(rule, input.baseMinor);
    const customerIsDebit = rule.componentType !== "INTEREST";
    const [debitAccount, creditAccount] = await Promise.all([
      customerIsDebit ? Promise.resolve(account) : tx.account.findFirst({ where: { glAccountId: rule.debitGlAccountId, currency: rule.currency, isSystem: true, status: "ACTIVE" } }),
      customerIsDebit ? tx.account.findFirst({ where: { glAccountId: rule.creditGlAccountId, currency: rule.currency, isSystem: true, status: "ACTIVE" } }) : Promise.resolve(account),
    ]);
    if (!debitAccount || !creditAccount) throw new AppError("PRICING_GL_UNAVAILABLE", "Pricing GL accounts are not provisioned.", 503);
    if (debitAccount.glAccountId !== rule.debitGlAccountId || creditAccount.glAccountId !== rule.creditGlAccountId) throw new AppError("PRICING_GL_MISMATCH", "Pricing rule does not match account GL mappings.", 409);
    if (customerIsDebit && account.availableBalanceMinor < amount) throw new AppError("INSUFFICIENT_FUNDS", "Available balance cannot cover the charge.", 409);
    await lock(tx, "Account", [debitAccount.id, creditAccount.id]);
    const journal = await tx.journal.create({ data: { reference: reference(rule.componentType), narration: `${rule.code} v${rule.version}`, currency: rule.currency, accountingPeriodId: period.id, metadata: { pricingRuleId: rule.id, chargedAccountId: account.id, baseMinor: input.baseMinor.toString() } } });
    const debitAfter = await tx.account.update({ where: { id: debitAccount.id }, data: customerIsDebit ? { ledgerBalanceMinor: { decrement: amount }, availableBalanceMinor: { decrement: amount } } : { ledgerBalanceMinor: { increment: amount }, availableBalanceMinor: { increment: amount } } });
    const creditAfter = await tx.account.update({ where: { id: creditAccount.id }, data: { ledgerBalanceMinor: { increment: amount }, availableBalanceMinor: { increment: amount } } });
    await tx.ledgerEntry.createMany({ data: [
      { journalId: journal.id, accountId: debitAccount.id, direction: "DEBIT", amountMinor: amount, currency: rule.currency, balanceAfterMinor: debitAfter.ledgerBalanceMinor },
      { journalId: journal.id, accountId: creditAccount.id, direction: "CREDIT", amountMinor: amount, currency: rule.currency, balanceAfterMinor: creditAfter.ledgerBalanceMinor },
    ] });
    await tx.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "PRICING_POSTED", resource: "Journal", resourceId: journal.id, outcome: "SUCCESS", metadata: { pricingRuleId: rule.id, amountMinor: amount.toString() } } });
    return journal;
  });
}

export async function closeAccountingPeriod(input: { periodId: string; actorId: string }) {
  return serializable(async (tx) => {
    const period = await tx.accountingPeriod.findUnique({ where: { id: input.periodId } });
    if (!period || period.status === "CLOSED") return period;
    if (period.endsAt > new Date()) throw new AppError("PERIOD_NOT_ENDED", "Accounting period has not ended.", 409);
    const [pendingJournals, pendingAccruals] = await Promise.all([
      tx.journal.count({ where: { accountingPeriodId: period.id, status: "PENDING" } }),
      tx.accrual.count({ where: { accrualDate: { gte: period.startsAt, lt: period.endsAt }, status: "PENDING" } }),
    ]);
    if (pendingJournals || pendingAccruals) throw new AppError("PERIOD_HAS_PENDING_WORK", "Period has pending journals or accruals.", 409);
    const totals = await tx.$queryRaw<Array<{ debit: bigint; credit: bigint }>>(Prisma.sql`SELECT COALESCE(SUM(e."amountMinor") FILTER (WHERE e."direction"='DEBIT'),0) debit, COALESCE(SUM(e."amountMinor") FILTER (WHERE e."direction"='CREDIT'),0) credit FROM "LedgerEntry" e JOIN "Journal" j ON j."id"=e."journalId" WHERE j."accountingPeriodId"=${period.id} AND j."status"='POSTED'`);
    if (totals[0]?.debit !== totals[0]?.credit) throw new AppError("PERIOD_UNBALANCED", "Period trial balance is not balanced.", 409);
    return tx.accountingPeriod.update({ where: { id: period.id }, data: { status: "CLOSED", closedAt: new Date(), closedBy: input.actorId } });
  });
}

export async function importReconciliationRun(input: { source: string; statementDate: Date; currency: string; controlTotalMinor: bigint; items: Array<{ externalId: string; amountMinor: bigint; valueDate: Date; journalId?: string }> }) {
  if (input.items.length > 100_000 || input.items.some((item) => item.amountMinor === 0n)) throw new AppError("INVALID_RECONCILIATION", "Statement item set is invalid.", 422);
  return serializable(async (tx) => {
    await requireCurrency(tx, input.currency);
    const calculated = input.items.reduce((total, item) => total + (item.amountMinor < 0n ? -item.amountMinor : item.amountMinor), 0n);
    if (calculated !== input.controlTotalMinor) throw new AppError("CONTROL_TOTAL_MISMATCH", "Statement control total does not match its items.", 422);
    const run = await tx.reconciliationRun.create({ data: { source: input.source, statementDate: input.statementDate, currency: input.currency, controlTotalMinor: input.controlTotalMinor, itemCount: input.items.length } });
    let matchedTotalMinor = 0n;
    for (const item of input.items) {
      let status: "MATCHED" | "UNMATCHED" | "EXCEPTION" = "UNMATCHED";
      if (item.journalId) {
        const journal = await tx.journal.findUnique({ where: { id: item.journalId }, include: { entries: true } });
        const amount = journal?.entries.filter((entry) => entry.direction === "DEBIT").reduce((total, entry) => total + entry.amountMinor, 0n);
        status = journal?.status === "POSTED" && journal.currency === input.currency && amount === (item.amountMinor < 0n ? -item.amountMinor : item.amountMinor) ? "MATCHED" : "EXCEPTION";
        if (status === "MATCHED") matchedTotalMinor += amount ?? 0n;
      }
      await tx.reconciliationItem.create({ data: { runId: run.id, externalId: item.externalId, amountMinor: item.amountMinor, currency: input.currency, valueDate: item.valueDate, journalId: item.journalId, status, exceptionCode: status === "EXCEPTION" ? "JOURNAL_MISMATCH" : undefined } });
    }
    return tx.reconciliationRun.update({ where: { id: run.id }, data: { status: "COMPLETED", matchedTotalMinor, completedAt: new Date() } });
  });
}

export async function getTrialBalance(periodId: string) {
  return getDb().$queryRaw<Array<{ glCode: string; currency: string; debitMinor: string; creditMinor: string }>>(Prisma.sql`
    SELECT g."code" AS "glCode", e."currency",
      COALESCE(SUM(e."amountMinor") FILTER (WHERE e."direction"='DEBIT'),0)::text AS "debitMinor",
      COALESCE(SUM(e."amountMinor") FILTER (WHERE e."direction"='CREDIT'),0)::text AS "creditMinor"
    FROM "LedgerEntry" e JOIN "Journal" j ON j."id"=e."journalId" AND j."status"='POSTED'
    JOIN "Account" a ON a."id"=e."accountId" JOIN "GlAccount" g ON g."id"=a."glAccountId"
    WHERE j."accountingPeriodId"=${periodId} GROUP BY g."code", e."currency" ORDER BY g."code", e."currency"
  `);
}

export async function consumeFxQuote(input: { quoteId: string; sourceAccountId: string; destinationAccountId: string; sourcePositionAccountId: string; destinationPositionAccountId: string }) {
  return serializable(async (tx) => {
    await lock(tx, "FxQuote", [input.quoteId]);
    const quote = await tx.fxQuote.findUnique({ where: { id: input.quoteId } });
    if (!quote || quote.status !== "ACTIVE" || quote.expiresAt <= new Date()) throw new AppError("FX_QUOTE_EXPIRED", "FX quote is unavailable or expired.", 409);
    await lock(tx, "Account", [input.sourceAccountId, input.destinationAccountId, input.sourcePositionAccountId, input.destinationPositionAccountId]);
    const accounts = await tx.account.findMany({ where: { id: { in: [input.sourceAccountId, input.destinationAccountId, input.sourcePositionAccountId, input.destinationPositionAccountId] } } });
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const source = byId.get(input.sourceAccountId), destination = byId.get(input.destinationAccountId), sourcePosition = byId.get(input.sourcePositionAccountId), destinationPosition = byId.get(input.destinationPositionAccountId);
    if (!source || !destination || !sourcePosition || !destinationPosition || source.currency !== quote.sourceCurrency || sourcePosition.currency !== quote.sourceCurrency || destination.currency !== quote.destinationCurrency || destinationPosition.currency !== quote.destinationCurrency || source.availableBalanceMinor < quote.sourceAmountMinor) throw new AppError("FX_ACCOUNTS_INVALID", "FX accounts, currencies, or funds are invalid.", 409);
    const period = await requireOpenAccountingPeriod(tx);
    const sourceJournal = await tx.journal.create({ data: { reference: reference("FXS"), narration: "FX source leg", currency: quote.sourceCurrency, accountingPeriodId: period.id } });
    const destinationJournal = await tx.journal.create({ data: { reference: reference("FXD"), narration: "FX destination leg", currency: quote.destinationCurrency, accountingPeriodId: period.id } });
    const sourceAfter = await tx.account.update({ where: { id: source.id }, data: { availableBalanceMinor: { decrement: quote.sourceAmountMinor }, ledgerBalanceMinor: { decrement: quote.sourceAmountMinor } } });
    const sourcePositionAfter = await tx.account.update({ where: { id: sourcePosition.id }, data: { availableBalanceMinor: { increment: quote.sourceAmountMinor }, ledgerBalanceMinor: { increment: quote.sourceAmountMinor } } });
    const destinationPositionAfter = await tx.account.update({ where: { id: destinationPosition.id }, data: { availableBalanceMinor: { increment: quote.destinationAmountMinor }, ledgerBalanceMinor: { increment: quote.destinationAmountMinor } } });
    const destinationAfter = await tx.account.update({ where: { id: destination.id }, data: { availableBalanceMinor: { increment: quote.destinationAmountMinor }, ledgerBalanceMinor: { increment: quote.destinationAmountMinor } } });
    await tx.ledgerEntry.createMany({ data: [
      { journalId: sourceJournal.id, accountId: source.id, direction: "DEBIT", amountMinor: quote.sourceAmountMinor, currency: quote.sourceCurrency, balanceAfterMinor: sourceAfter.ledgerBalanceMinor },
      { journalId: sourceJournal.id, accountId: sourcePosition.id, direction: "CREDIT", amountMinor: quote.sourceAmountMinor, currency: quote.sourceCurrency, balanceAfterMinor: sourcePositionAfter.ledgerBalanceMinor },
      { journalId: destinationJournal.id, accountId: destinationPosition.id, direction: "DEBIT", amountMinor: quote.destinationAmountMinor, currency: quote.destinationCurrency, balanceAfterMinor: destinationPositionAfter.ledgerBalanceMinor },
      { journalId: destinationJournal.id, accountId: destination.id, direction: "CREDIT", amountMinor: quote.destinationAmountMinor, currency: quote.destinationCurrency, balanceAfterMinor: destinationAfter.ledgerBalanceMinor },
    ] });
    await Promise.all([tx.journal.update({ where: { id: sourceJournal.id }, data: { status: "POSTED", postedAt: new Date() } }), tx.journal.update({ where: { id: destinationJournal.id }, data: { status: "POSTED", postedAt: new Date() } })]);
    const trade = await tx.fxTrade.create({ data: { quoteId: quote.id, sourceAccountId: source.id, destinationAccountId: destination.id, sourcePositionAccountId: sourcePosition.id, destinationPositionAccountId: destinationPosition.id, sourceJournalId: sourceJournal.id, destinationJournalId: destinationJournal.id } });
    await tx.fxQuote.update({ where: { id: quote.id }, data: { status: "CONSUMED" } });
    return trade;
  });
}
