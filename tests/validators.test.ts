import { describe, expect, it } from "vitest";

import { kycDecisionSchema } from "@/lib/validators";

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
