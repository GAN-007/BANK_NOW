-- Persist anti-replay, idempotency, settlement, and webhook-processing state.
ALTER TABLE "MfaFactor" ADD COLUMN "lastUsedTimestep" BIGINT;
ALTER TABLE "MfaChallenge" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PaymentIntent"
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "settlementReference" TEXT;

ALTER TABLE "ProviderWebhook"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "processingStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- A provider reference is unique within its provider, not across unrelated rails.
DROP INDEX "PaymentIntent_providerReference_key";
CREATE UNIQUE INDEX "PaymentIntent_provider_providerReference_key"
  ON "PaymentIntent"("provider", "providerReference");
CREATE UNIQUE INDEX "PaymentIntent_provider_settlementReference_key"
  ON "PaymentIntent"("provider", "settlementReference");

-- Operator-defined transaction limits intentionally have no implicit defaults.
CREATE TABLE "TransactionPolicy" (
  "currency" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "maximumAmountMinor" BIGINT NOT NULL,
  "rolling24HourAmountLimitMinor" BIGINT NOT NULL,
  "rolling24HourCountLimit" INTEGER NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransactionPolicy_pkey" PRIMARY KEY ("currency")
);

CREATE TYPE "SettlementReviewStatus" AS ENUM ('REQUESTED', 'APPROVED', 'EXECUTED', 'REJECTED');

CREATE TABLE "SettlementReview" (
  "id" TEXT NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "settlementReference" TEXT NOT NULL,
  "encryptedEvidenceReference" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "SettlementReviewStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "rejectedById" TEXT,
  "rejectionReason" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "executedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  CONSTRAINT "SettlementReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementReview_distinct_approver"
    CHECK ("approvedById" IS NULL OR "approvedById" <> "requestedById"),
  CONSTRAINT "SettlementReview_distinct_rejector"
    CHECK ("rejectedById" IS NULL OR "rejectedById" <> "requestedById"),
  CONSTRAINT "SettlementReview_state_fields"
    CHECK (
      (
        "status" = 'REQUESTED' AND
        "approvedById" IS NULL AND "approvedAt" IS NULL AND "executedAt" IS NULL AND
        "rejectedById" IS NULL AND "rejectionReason" IS NULL AND "rejectedAt" IS NULL
      ) OR (
        "status" = 'APPROVED' AND
        "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL AND "executedAt" IS NULL AND
        "rejectedById" IS NULL AND "rejectionReason" IS NULL AND "rejectedAt" IS NULL
      ) OR (
        "status" = 'EXECUTED' AND
        "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL AND "executedAt" IS NOT NULL AND
        "rejectedById" IS NULL AND "rejectionReason" IS NULL AND "rejectedAt" IS NULL
      ) OR (
        "status" = 'REJECTED' AND
        "approvedById" IS NULL AND "approvedAt" IS NULL AND "executedAt" IS NULL AND
        "rejectedById" IS NOT NULL AND "rejectionReason" IS NOT NULL AND "rejectedAt" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "SettlementReview_requestedById_idempotencyKey_key"
  ON "SettlementReview"("requestedById", "idempotencyKey");
CREATE UNIQUE INDEX "SettlementReview_paymentIntentId_settlementReference_key"
  ON "SettlementReview"("paymentIntentId", "settlementReference");
CREATE INDEX "SettlementReview_status_requestedAt_idx"
  ON "SettlementReview"("status", "requestedAt");
CREATE INDEX "SettlementReview_paymentIntentId_status_idx"
  ON "SettlementReview"("paymentIntentId", "status");

ALTER TABLE "SettlementReview"
  ADD CONSTRAINT "SettlementReview_paymentIntentId_fkey"
  FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementReview"
  ADD CONSTRAINT "SettlementReview_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementReview"
  ADD CONSTRAINT "SettlementReview_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementReview"
  ADD CONSTRAINT "SettlementReview_rejectedById_fkey"
  FOREIGN KEY ("rejectedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants are enforced beneath the application layer.
ALTER TABLE "User"
  ADD CONSTRAINT "User_failedLoginCount_nonnegative" CHECK ("failedLoginCount" >= 0);
ALTER TABLE "MfaFactor"
  ADD CONSTRAINT "MfaFactor_lastUsedTimestep_nonnegative"
  CHECK ("lastUsedTimestep" IS NULL OR "lastUsedTimestep" >= 0);
ALTER TABLE "MfaChallenge"
  ADD CONSTRAINT "MfaChallenge_attemptCount_range" CHECK ("attemptCount" BETWEEN 0 AND 5);
ALTER TABLE "Account"
  ADD CONSTRAINT "Account_currency_iso_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Account_availableBalance_nonnegative" CHECK ("availableBalanceMinor" >= 0),
  ADD CONSTRAINT "Account_ledgerBalance_nonnegative" CHECK ("ledgerBalanceMinor" >= 0);
ALTER TABLE "Journal"
  ADD CONSTRAINT "Journal_currency_iso_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Journal_posted_has_timestamp"
    CHECK ("status" <> 'POSTED' OR "postedAt" IS NOT NULL),
  ADD CONSTRAINT "Journal_reversed_has_timestamp"
    CHECK ("status" <> 'REVERSED' OR "reversedAt" IS NOT NULL);
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_amount_positive" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "LedgerEntry_currency_iso_format" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "Transfer"
  ADD CONSTRAINT "Transfer_amount_positive" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "Transfer_currency_iso_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Transfer_accounts_distinct" CHECK ("sourceAccountId" <> "destinationAccountId"),
  ADD CONSTRAINT "Transfer_posted_has_timestamp"
    CHECK ("status" <> 'POSTED' OR "postedAt" IS NOT NULL),
  ADD CONSTRAINT "Transfer_reversed_has_timestamp"
    CHECK ("status" <> 'REVERSED' OR "reversedAt" IS NOT NULL);
ALTER TABLE "PaymentIntent"
  ADD CONSTRAINT "PaymentIntent_amount_positive" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "PaymentIntent_currency_iso_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "PaymentIntent_succeeded_is_posted"
    CHECK ("status" <> 'SUCCEEDED' OR ("completedAt" IS NOT NULL AND "journalId" IS NOT NULL));
ALTER TABLE "ProviderWebhook"
  ADD CONSTRAINT "ProviderWebhook_attemptCount_positive" CHECK ("attemptCount" > 0);
ALTER TABLE "RateLimitBucket"
  ADD CONSTRAINT "RateLimitBucket_count_nonnegative" CHECK ("count" >= 0);
ALTER TABLE "TransactionPolicy"
  ADD CONSTRAINT "TransactionPolicy_currency_iso_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "TransactionPolicy_maximum_positive" CHECK ("maximumAmountMinor" > 0),
  ADD CONSTRAINT "TransactionPolicy_rolling_amount_valid"
    CHECK ("rolling24HourAmountLimitMinor" >= "maximumAmountMinor"),
  ADD CONSTRAINT "TransactionPolicy_rolling_count_positive"
    CHECK ("rolling24HourCountLimit" > 0);

-- Ledger entries are append-only. Corrections must be represented by a new journal.
CREATE FUNCTION bank_now_reject_ledger_entry_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Ledger entries are immutable; post a compensating journal instead.'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerEntry_immutable"
  BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION bank_now_reject_ledger_entry_mutation();

CREATE FUNCTION bank_now_validate_ledger_entry_insert() RETURNS trigger AS $$
DECLARE
  insert_allowed BOOLEAN;
BEGIN
  SELECT
    j."status" = 'PENDING' AND
    j."currency" = NEW."currency" AND
    a."currency" = NEW."currency"
  INTO insert_allowed
  FROM "Journal" j
  CROSS JOIN "Account" a
  WHERE j."id" = NEW."journalId" AND a."id" = NEW."accountId";

  IF insert_allowed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Ledger entries require a pending journal and matching currencies.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerEntry_validate_insert"
  BEFORE INSERT ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION bank_now_validate_ledger_entry_insert();

-- Validate balancing at the exact state transition that makes a journal effective.
CREATE FUNCTION bank_now_validate_journal_posting() RETURNS trigger AS $$
DECLARE
  entry_count BIGINT;
  debit_total NUMERIC;
  credit_total NUMERIC;
  currency_mismatches BIGINT;
  should_validate BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    should_validate := NEW."status" = 'POSTED';
  ELSE
    should_validate := NEW."status" = 'POSTED' AND OLD."status" <> 'POSTED';
  END IF;

  IF should_validate THEN
    SELECT
      COUNT(*),
      COALESCE(SUM("amountMinor") FILTER (WHERE "direction" = 'DEBIT'), 0),
      COALESCE(SUM("amountMinor") FILTER (WHERE "direction" = 'CREDIT'), 0),
      COUNT(*) FILTER (WHERE "currency" <> NEW."currency")
    INTO entry_count, debit_total, credit_total, currency_mismatches
    FROM "LedgerEntry"
    WHERE "journalId" = NEW."id";

    IF entry_count < 2 OR debit_total <> credit_total OR currency_mismatches <> 0 THEN
      RAISE EXCEPTION 'Journal % is not balanced in %.', NEW."reference", NEW."currency"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Journal_validate_posting"
  BEFORE INSERT OR UPDATE OF "status" ON "Journal"
  FOR EACH ROW EXECUTE FUNCTION bank_now_validate_journal_posting();

-- A posted business object must point to the already validated posted journal.
CREATE FUNCTION bank_now_validate_posted_reference() RETURNS trigger AS $$
DECLARE
  journal_is_posted BOOLEAN;
  should_validate BOOLEAN := false;
BEGIN
  IF TG_TABLE_NAME = 'Transfer' THEN
    IF TG_OP = 'INSERT' THEN
      should_validate := NEW."status" = 'POSTED';
    ELSE
      should_validate := NEW."status" = 'POSTED' AND OLD."status" <> 'POSTED';
    END IF;
    IF should_validate THEN
      SELECT EXISTS(
        SELECT 1 FROM "Journal" WHERE "id" = NEW."journalId" AND "status" = 'POSTED'
      ) INTO journal_is_posted;
    END IF;
  ELSIF TG_TABLE_NAME = 'PaymentIntent' THEN
    IF TG_OP = 'INSERT' THEN
      should_validate := NEW."status" = 'SUCCEEDED';
    ELSE
      should_validate := NEW."status" = 'SUCCEEDED' AND OLD."status" <> 'SUCCEEDED';
    END IF;
    IF should_validate THEN
      SELECT EXISTS(
        SELECT 1 FROM "Journal" WHERE "id" = NEW."journalId" AND "status" = 'POSTED'
      ) INTO journal_is_posted;
    END IF;
  END IF;

  IF should_validate AND NOT journal_is_posted THEN
    RAISE EXCEPTION '% cannot become posted without a posted journal.', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Transfer_validate_posted_journal"
  BEFORE INSERT OR UPDATE OF "status" ON "Transfer"
  FOR EACH ROW EXECUTE FUNCTION bank_now_validate_posted_reference();

CREATE TRIGGER "PaymentIntent_validate_posted_journal"
  BEFORE INSERT OR UPDATE OF "status" ON "PaymentIntent"
  FOR EACH ROW EXECUTE FUNCTION bank_now_validate_posted_reference();

-- Financial identity is immutable even while operational status evolves.
CREATE FUNCTION bank_now_protect_financial_identity() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'Transfer' AND (
    NEW."initiatorId" IS DISTINCT FROM OLD."initiatorId" OR
    NEW."sourceAccountId" IS DISTINCT FROM OLD."sourceAccountId" OR
    NEW."destinationAccountId" IS DISTINCT FROM OLD."destinationAccountId" OR
    NEW."journalId" IS DISTINCT FROM OLD."journalId" OR
    NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" OR
    NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR
    NEW."currency" IS DISTINCT FROM OLD."currency"
  ) THEN
    RAISE EXCEPTION 'Transfer financial identity is immutable.' USING ERRCODE = '55000';
  END IF;

  IF TG_TABLE_NAME = 'PaymentIntent' AND (
    NEW."userId" IS DISTINCT FROM OLD."userId" OR
    NEW."accountId" IS DISTINCT FROM OLD."accountId" OR
    NEW."provider" IS DISTINCT FROM OLD."provider" OR
    NEW."method" IS DISTINCT FROM OLD."method" OR
    NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" OR
    NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR
    NEW."currency" IS DISTINCT FROM OLD."currency" OR
    NEW."requestHash" IS DISTINCT FROM OLD."requestHash" OR
    (OLD."providerReference" IS NOT NULL AND NEW."providerReference" IS DISTINCT FROM OLD."providerReference") OR
    (OLD."settlementReference" IS NOT NULL AND NEW."settlementReference" IS DISTINCT FROM OLD."settlementReference")
  ) THEN
    RAISE EXCEPTION 'Payment intent financial identity is immutable.' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Transfer_financial_identity_immutable"
  BEFORE UPDATE ON "Transfer"
  FOR EACH ROW EXECUTE FUNCTION bank_now_protect_financial_identity();

CREATE TRIGGER "PaymentIntent_financial_identity_immutable"
  BEFORE UPDATE ON "PaymentIntent"
  FOR EACH ROW EXECUTE FUNCTION bank_now_protect_financial_identity();

CREATE FUNCTION bank_now_protect_settlement_review() RETURNS trigger AS $$
BEGIN
  IF NEW."paymentIntentId" IS DISTINCT FROM OLD."paymentIntentId" OR
     NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" OR
     NEW."requestHash" IS DISTINCT FROM OLD."requestHash" OR
     NEW."settlementReference" IS DISTINCT FROM OLD."settlementReference" OR
     NEW."encryptedEvidenceReference" IS DISTINCT FROM OLD."encryptedEvidenceReference" OR
     NEW."evidenceHash" IS DISTINCT FROM OLD."evidenceHash" OR
     NEW."reason" IS DISTINCT FROM OLD."reason" OR
     NEW."requestedById" IS DISTINCT FROM OLD."requestedById" OR
     NEW."requestedAt" IS DISTINCT FROM OLD."requestedAt" THEN
    RAISE EXCEPTION 'Settlement review evidence is immutable.' USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'REQUESTED' AND NEW."status" NOT IN ('REQUESTED', 'APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Invalid settlement review transition.' USING ERRCODE = '55000';
  ELSIF OLD."status" = 'APPROVED' AND NEW."status" NOT IN ('APPROVED', 'EXECUTED') THEN
    RAISE EXCEPTION 'Invalid settlement review transition.' USING ERRCODE = '55000';
  ELSIF OLD."status" IN ('EXECUTED', 'REJECTED') AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'Terminal settlement review state cannot change.' USING ERRCODE = '55000';
  END IF;

  IF OLD."status" <> 'REQUESTED' AND (
    NEW."approvedById" IS DISTINCT FROM OLD."approvedById" OR
    NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" OR
    NEW."rejectedById" IS DISTINCT FROM OLD."rejectedById" OR
    NEW."rejectionReason" IS DISTINCT FROM OLD."rejectionReason" OR
    NEW."rejectedAt" IS DISTINCT FROM OLD."rejectedAt"
  ) THEN
    RAISE EXCEPTION 'Settlement review decision is immutable.' USING ERRCODE = '55000';
  END IF;

  IF OLD."status" <> 'APPROVED' AND NEW."executedAt" IS DISTINCT FROM OLD."executedAt" THEN
    RAISE EXCEPTION 'Settlement execution timestamp is immutable.' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SettlementReview_protect_evidence_and_state"
  BEFORE UPDATE ON "SettlementReview"
  FOR EACH ROW EXECUTE FUNCTION bank_now_protect_settlement_review();

-- Posted journal identity and terminal state transitions cannot be rewritten.
CREATE FUNCTION bank_now_protect_journal() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'Posted journals cannot be deleted.' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" IN ('POSTED', 'REVERSED') THEN
    IF NEW."reference" IS DISTINCT FROM OLD."reference" OR
       NEW."currency" IS DISTINCT FROM OLD."currency" OR
       NEW."externalReference" IS DISTINCT FROM OLD."externalReference" OR
       NEW."narration" IS DISTINCT FROM OLD."narration" OR
       NEW."metadata" IS DISTINCT FROM OLD."metadata" OR
       NEW."postedAt" IS DISTINCT FROM OLD."postedAt" THEN
      RAISE EXCEPTION 'Posted journal identity is immutable.' USING ERRCODE = '55000';
    END IF;

    IF OLD."status" = 'POSTED' AND NEW."status" NOT IN ('POSTED', 'REVERSED') THEN
      RAISE EXCEPTION 'A posted journal can only remain posted or be reversed.' USING ERRCODE = '55000';
    END IF;

    IF OLD."status" = 'REVERSED' AND NEW."status" <> 'REVERSED' THEN
      RAISE EXCEPTION 'A reversed journal is terminal.' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Journal_protect_posted"
  BEFORE UPDATE OR DELETE ON "Journal"
  FOR EACH ROW EXECUTE FUNCTION bank_now_protect_journal();
