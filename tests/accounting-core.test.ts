import { describe, expect, it } from "vitest";

import { PricingCalculationType } from "@/generated/prisma/client";
import { calculatePricing } from "@/lib/domain/accounting-core";

describe("Prisma-native accounting core", () => {
  it("calculates basis-point pricing with deterministic ceiling and bounds", () => {
    expect(calculatePricing({
      calculationType: PricingCalculationType.BASIS_POINTS,
      flatAmountMinor: null,
      basisPoints: 125,
      minimumMinor: 100n,
      maximumMinor: 2_000n,
    }, 10_001n)).toBe(126n);
    expect(calculatePricing({
      calculationType: PricingCalculationType.BASIS_POINTS,
      flatAmountMinor: null,
      basisPoints: 1,
      minimumMinor: 50n,
      maximumMinor: null,
    }, 100n)).toBe(50n);
  });

  it("rejects incomplete or non-positive pricing calculations", () => {
    expect(() => calculatePricing({
      calculationType: PricingCalculationType.FLAT,
      flatAmountMinor: null,
      basisPoints: null,
      minimumMinor: null,
      maximumMinor: null,
    }, 100n)).toThrow("Pricing rule is incomplete");
    expect(() => calculatePricing({
      calculationType: PricingCalculationType.FLAT,
      flatAmountMinor: 10n,
      basisPoints: null,
      minimumMinor: null,
      maximumMinor: null,
    }, 0n)).toThrow("Pricing base must be positive");
  });
});
