import { describe, expect, it } from "vitest";

import {
  accountingPeriodSchema,
  currencyConfigurationSchema,
  glAccountConfigurationSchema,
  kycDecisionSchema,
  outboxClaimSchema,
} from "@/lib/validators";

describe("controlled KYC decisions", () => {
  it("does not let the staff decision endpoint requeue a pending case", () => {
    expect(kycDecisionSchema.safeParse({ status: "PENDING" }).success).toBe(
      false,
    );
  });

  it("requires approved external evidence before verification", () => {
    expect(kycDecisionSchema.safeParse({ status: "VERIFIED" }).success).toBe(
      false,
    );
    expect(
      kycDecisionSchema.safeParse({
        status: "VERIFIED",
        provider: "Approved verification workflow",
        providerReference: "CASE-2026-000184",
      }).success,
    ).toBe(true);
  });

  it("requires a reason for a rejected identity case", () => {
    expect(kycDecisionSchema.safeParse({ status: "REJECTED" }).success).toBe(
      false,
    );
    expect(
      kycDecisionSchema.safeParse({
        status: "REJECTED",
        rejectionReason: "Evidence did not match the account holder.",
      }).success,
    ).toBe(true);
  });
});

describe("accounting operations validation", () => {
  it("rejects settlement for a disabled currency", () => {
    expect(currencyConfigurationSchema.safeParse({
      code: "KES",
      exponent: 2,
      name: "Kenyan shilling",
      enabled: false,
      settlementEnabled: true,
    }).success).toBe(false);
  });

  it("accepts bounded GL and accounting-period definitions", () => {
    expect(glAccountConfigurationSchema.safeParse({
      code: "2100.CUSTOMER_DEPOSITS",
      name: "Customer deposits",
      ledgerClass: "LIABILITY",
      currency: "kes",
      allowManualPosting: false,
      effectiveFrom: "2026-07-01T00:00:00Z",
    }).success).toBe(true);
    expect(accountingPeriodSchema.safeParse({
      code: "2026-07",
      startsAt: "2026-07-01T00:00:00Z",
      endsAt: "2026-08-01T00:00:00Z",
    }).success).toBe(true);
  });

  it("bounds outbox worker leases and batches", () => {
    expect(outboxClaimSchema.safeParse({ workerId: "worker-1", limit: 500, leaseSeconds: 900 }).success).toBe(true);
    expect(outboxClaimSchema.safeParse({ workerId: "worker-1", limit: 501, leaseSeconds: 60 }).success).toBe(false);
    expect(outboxClaimSchema.safeParse({ workerId: "worker-1", limit: 1, leaseSeconds: 9 }).success).toBe(false);
  });
});
