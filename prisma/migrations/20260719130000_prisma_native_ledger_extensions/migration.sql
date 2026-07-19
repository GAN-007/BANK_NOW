-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'PARTIALLY_CAPTURED', 'CAPTURED', 'RELEASED', 'EXPIRED');

ALTER TYPE "PaymentIntentStatus" ADD VALUE 'REVERSED';

-- CreateEnum
CREATE TYPE "PaymentRail" AS ENUM ('INTERNAL', 'MPESA', 'PESALINK', 'EFT', 'RTGS', 'SWIFT', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentInstructionStatus" AS ENUM ('RECEIVED', 'SCREENING', 'AUTHORIZED', 'FUNDS_HELD', 'SUBMITTED', 'ACCEPTED', 'SETTLED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED');

-- CreateEnum
CREATE TYPE "PricingComponentType" AS ENUM ('FEE', 'TAX', 'INTEREST');

-- CreateEnum
CREATE TYPE "PricingCalculationType" AS ENUM ('FLAT', 'BASIS_POINTS');

-- CreateEnum
CREATE TYPE "AccrualStatus" AS ENUM ('PENDING', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "FxQuoteStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReconciliationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationItemStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'EXCEPTION', 'RESOLVED');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "glAccountId" TEXT,
ADD COLUMN     "heldBalanceMinor" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Journal" ADD COLUMN     "accountingPeriodId" TEXT,
ADD COLUMN     "originalJournalId" TEXT;

-- CreateTable
CREATE TABLE "CurrencyDefinition" (
    "code" TEXT NOT NULL,
    "exponent" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "settlementEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrencyDefinition_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "GlAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ledgerClass" "LedgerAccountClass" NOT NULL,
    "normalDirection" "EntryDirection" NOT NULL,
    "currency" TEXT,
    "allowManualPosting" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundsHold" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "capturedAmountMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "FundsHold_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FundsHoldCapture" (
    "id" TEXT NOT NULL,
    "holdId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FundsHoldCapture_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FundsHoldCapture_amount_positive" CHECK ("amountMinor" > 0)
);

-- CreateTable
CREATE TABLE "PaymentInstruction" (
    "id" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "sourceAccountId" TEXT,
    "rail" "PaymentRail" NOT NULL,
    "status" "PaymentInstructionStatus" NOT NULL DEFAULT 'RECEIVED',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "beneficiary" JSONB NOT NULL,
    "providerReference" TEXT,
    "holdId" TEXT,
    "settlementJournalId" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "PaymentInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxMessage" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "encryptedPayload" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "componentType" "PricingComponentType" NOT NULL,
    "calculationType" "PricingCalculationType" NOT NULL,
    "currency" TEXT NOT NULL,
    "flatAmountMinor" BIGINT,
    "basisPoints" INTEGER,
    "minimumMinor" BIGINT,
    "maximumMinor" BIGINT,
    "debitGlAccountId" TEXT NOT NULL,
    "creditGlAccountId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Accrual" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "pricingRuleId" TEXT NOT NULL,
    "accrualDate" TIMESTAMP(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "AccrualStatus" NOT NULL DEFAULT 'PENDING',
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Accrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxQuote" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "sourceCurrency" TEXT NOT NULL,
    "destinationCurrency" TEXT NOT NULL,
    "sourceAmountMinor" BIGINT NOT NULL,
    "destinationAmountMinor" BIGINT NOT NULL,
    "rateNumerator" BIGINT NOT NULL,
    "rateDenominator" BIGINT NOT NULL,
    "spreadBasisPoints" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "FxQuoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxTrade" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "sourceAccountId" TEXT NOT NULL,
    "destinationAccountId" TEXT NOT NULL,
    "sourcePositionAccountId" TEXT NOT NULL,
    "destinationPositionAccountId" TEXT NOT NULL,
    "sourceJournalId" TEXT NOT NULL,
    "destinationJournalId" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "ReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "controlTotalMinor" BIGINT NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "matchedTotalMinor" BIGINT NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "valueDate" TIMESTAMP(3) NOT NULL,
    "status" "ReconciliationItemStatus" NOT NULL DEFAULT 'UNMATCHED',
    "journalId" TEXT,
    "exceptionCode" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "ReconciliationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlAccount_code_key" ON "GlAccount"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_code_key" ON "AccountingPeriod"("code");

-- CreateIndex
CREATE INDEX "AccountingPeriod_status_startsAt_endsAt_idx" ON "AccountingPeriod"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "FundsHoldCapture_journalId_key" ON "FundsHoldCapture"("journalId");
CREATE UNIQUE INDEX "FundsHoldCapture_holdId_idempotencyKey_key" ON "FundsHoldCapture"("holdId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "FundsHold_status_expiresAt_idx" ON "FundsHold"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "FundsHold_accountId_idempotencyKey_key" ON "FundsHold"("accountId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "FundsHold_accountId_externalReference_key" ON "FundsHold"("accountId", "externalReference");

-- CreateIndex
CREATE INDEX "PaymentInstruction_rail_status_createdAt_idx" ON "PaymentInstruction"("rail", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentInstruction_initiatorId_idempotencyKey_key" ON "PaymentInstruction"("initiatorId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentInstruction_rail_providerReference_key" ON "PaymentInstruction"("rail", "providerReference");
CREATE UNIQUE INDEX "PaymentInstruction_holdId_key" ON "PaymentInstruction"("holdId");

-- CreateIndex
CREATE INDEX "OutboxMessage_status_availableAt_leaseExpiresAt_idx" ON "OutboxMessage"("status", "availableAt", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMessage_aggregateType_aggregateId_eventType_payloadHa_key" ON "OutboxMessage"("aggregateType", "aggregateId", "eventType", "payloadHash");

-- CreateIndex
CREATE INDEX "InboxMessage_status_receivedAt_idx" ON "InboxMessage"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboxMessage_source_externalId_key" ON "InboxMessage"("source", "externalId");

-- CreateIndex
CREATE INDEX "PricingRule_code_active_effectiveFrom_idx" ON "PricingRule"("code", "active", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_code_version_key" ON "PricingRule"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Accrual_journalId_key" ON "Accrual"("journalId");

-- CreateIndex
CREATE INDEX "Accrual_status_accrualDate_idx" ON "Accrual"("status", "accrualDate");

-- CreateIndex
CREATE UNIQUE INDEX "Accrual_accountId_pricingRuleId_accrualDate_key" ON "Accrual"("accountId", "pricingRuleId", "accrualDate");

-- CreateIndex
CREATE UNIQUE INDEX "FxQuote_reference_key" ON "FxQuote"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "FxTrade_quoteId_key" ON "FxTrade"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "FxTrade_sourceJournalId_key" ON "FxTrade"("sourceJournalId");

-- CreateIndex
CREATE UNIQUE INDEX "FxTrade_destinationJournalId_key" ON "FxTrade"("destinationJournalId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationRun_source_statementDate_currency_key" ON "ReconciliationRun"("source", "statementDate", "currency");

-- CreateIndex
CREATE INDEX "ReconciliationItem_status_valueDate_idx" ON "ReconciliationItem"("status", "valueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationItem_runId_externalId_key" ON "ReconciliationItem"("runId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Journal_originalJournalId_key" ON "Journal"("originalJournalId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journal" ADD CONSTRAINT "Journal_accountingPeriodId_fkey" FOREIGN KEY ("accountingPeriodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journal" ADD CONSTRAINT "Journal_originalJournalId_fkey" FOREIGN KEY ("originalJournalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundsHold" ADD CONSTRAINT "FundsHold_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundsHoldCapture" ADD CONSTRAINT "FundsHoldCapture_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "FundsHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FundsHoldCapture" ADD CONSTRAINT "FundsHoldCapture_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentInstruction" ADD CONSTRAINT "PaymentInstruction_settlementJournalId_fkey" FOREIGN KEY ("settlementJournalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentInstruction" ADD CONSTRAINT "PaymentInstruction_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentInstruction" ADD CONSTRAINT "PaymentInstruction_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentInstruction" ADD CONSTRAINT "PaymentInstruction_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "FundsHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accrual" ADD CONSTRAINT "Accrual_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accrual" ADD CONSTRAINT "Accrual_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Accrual" ADD CONSTRAINT "Accrual_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "PricingRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_debitGlAccountId_fkey" FOREIGN KEY ("debitGlAccountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_creditGlAccountId_fkey" FOREIGN KEY ("creditGlAccountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxTrade" ADD CONSTRAINT "FxTrade_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "FxQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxTrade" ADD CONSTRAINT "FxTrade_sourceJournalId_fkey" FOREIGN KEY ("sourceJournalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxTrade" ADD CONSTRAINT "FxTrade_destinationJournalId_fkey" FOREIGN KEY ("destinationJournalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FxTrade" ADD CONSTRAINT "FxTrade_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FxTrade" ADD CONSTRAINT "FxTrade_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FxTrade" ADD CONSTRAINT "FxTrade_sourcePositionAccountId_fkey" FOREIGN KEY ("sourcePositionAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FxTrade" ADD CONSTRAINT "FxTrade_destinationPositionAccountId_fkey" FOREIGN KEY ("destinationPositionAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationItem" ADD CONSTRAINT "ReconciliationItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReconciliationItem" ADD CONSTRAINT "ReconciliationItem_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial invariants are enforced below the ORM boundary.
ALTER TABLE "CurrencyDefinition"
  ADD CONSTRAINT "CurrencyDefinition_code_iso" CHECK ("code" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "CurrencyDefinition_exponent_range" CHECK ("exponent" BETWEEN 0 AND 6),
  ADD CONSTRAINT "CurrencyDefinition_settlement_requires_enabled" CHECK (NOT "settlementEnabled" OR "enabled");
ALTER TABLE "GlAccount"
  ADD CONSTRAINT "GlAccount_effective_range" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  ADD CONSTRAINT "GlAccount_currency_iso" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "AccountingPeriod"
  ADD CONSTRAINT "AccountingPeriod_date_range" CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "AccountingPeriod_closed_fields" CHECK (("status" <> 'CLOSED') OR ("closedAt" IS NOT NULL AND "closedBy" IS NOT NULL));
ALTER TABLE "Account"
  ADD CONSTRAINT "Account_heldBalance_nonnegative" CHECK ("heldBalanceMinor" >= 0),
  ADD CONSTRAINT "Account_available_plus_held_lte_ledger" CHECK ("availableBalanceMinor" + "heldBalanceMinor" <= "ledgerBalanceMinor");
ALTER TABLE "FundsHold"
  ADD CONSTRAINT "FundsHold_amount_positive" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "FundsHold_capture_range" CHECK ("capturedAmountMinor" >= 0 AND "capturedAmountMinor" <= "amountMinor"),
  ADD CONSTRAINT "FundsHold_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "FundsHold_state_consistency" CHECK (
    ("status"='ACTIVE' AND "capturedAmountMinor"=0) OR
    ("status"='PARTIALLY_CAPTURED' AND "capturedAmountMinor">0 AND "capturedAmountMinor"<"amountMinor") OR
    ("status"='CAPTURED' AND "capturedAmountMinor"="amountMinor") OR
    ("status" IN ('RELEASED','EXPIRED') AND "releasedAt" IS NOT NULL)
  );
ALTER TABLE "PaymentInstruction"
  ADD CONSTRAINT "PaymentInstruction_amount_positive" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "PaymentInstruction_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "PaymentInstruction_settled_fields" CHECK ("status" <> 'SETTLED' OR ("settledAt" IS NOT NULL AND "settlementJournalId" IS NOT NULL));
ALTER TABLE "OutboxMessage"
  ADD CONSTRAINT "OutboxMessage_attempt_nonnegative" CHECK ("attemptCount" >= 0),
  ADD CONSTRAINT "OutboxMessage_lease_consistency" CHECK (("status"='PROCESSING') = ("leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL));
ALTER TABLE "InboxMessage" ADD CONSTRAINT "InboxMessage_attempt_nonnegative" CHECK ("attemptCount" >= 0);
ALTER TABLE "PricingRule"
  ADD CONSTRAINT "PricingRule_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "PricingRule_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "PricingRule_effective_range" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  ADD CONSTRAINT "PricingRule_calculation_fields" CHECK (
    ("calculationType"='FLAT' AND "flatAmountMinor" IS NOT NULL AND "flatAmountMinor">=0 AND "basisPoints" IS NULL) OR
    ("calculationType"='BASIS_POINTS' AND "basisPoints" IS NOT NULL AND "basisPoints" BETWEEN 0 AND 100000 AND "flatAmountMinor" IS NULL)
  ),
  ADD CONSTRAINT "PricingRule_bounds" CHECK (("minimumMinor" IS NULL OR "minimumMinor">=0) AND ("maximumMinor" IS NULL OR "maximumMinor">=COALESCE("minimumMinor",0)));
ALTER TABLE "Accrual"
  ADD CONSTRAINT "Accrual_amount_positive" CHECK ("amountMinor">0),
  ADD CONSTRAINT "Accrual_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Accrual_posted_journal" CHECK ("status" <> 'POSTED' OR "journalId" IS NOT NULL);
ALTER TABLE "FxQuote"
  ADD CONSTRAINT "FxQuote_currencies_distinct" CHECK ("sourceCurrency" <> "destinationCurrency"),
  ADD CONSTRAINT "FxQuote_amounts_positive" CHECK ("sourceAmountMinor">0 AND "destinationAmountMinor">0 AND "rateNumerator">0 AND "rateDenominator">0),
  ADD CONSTRAINT "FxQuote_spread_range" CHECK ("spreadBasisPoints" BETWEEN 0 AND 10000);
ALTER TABLE "ReconciliationRun"
  ADD CONSTRAINT "ReconciliationRun_control_nonnegative" CHECK ("controlTotalMinor">=0 AND "matchedTotalMinor">=0 AND "itemCount">=0),
  ADD CONSTRAINT "ReconciliationRun_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "ReconciliationItem"
  ADD CONSTRAINT "ReconciliationItem_amount_nonzero" CHECK ("amountMinor"<>0),
  ADD CONSTRAINT "ReconciliationItem_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');

INSERT INTO "CurrencyDefinition" ("code","exponent","name","enabled","settlementEnabled","updatedAt") VALUES
  ('KES',2,'Kenyan Shilling',true,true),
  ('USD',2,'United States Dollar',true,false),
  ('EUR',2,'Euro',true,false),
  ('GBP',2,'Pound Sterling',true,false),
  ('JPY',0,'Japanese Yen',false,false),
  ('KWD',3,'Kuwaiti Dinar',false,false);
