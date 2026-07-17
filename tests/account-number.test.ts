import { describe, expect, it } from "vitest";

import { generateAccountNumber } from "@/lib/accounts";

function hasValidLuhnCheckDigit(value: string): boolean {
  let total = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if ((value.length - 1 - index) % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    total += digit;
  }
  return total % 10 === 0;
}

describe("account number generation", () => {
  it("creates a 13-digit account identifier with a valid check digit", () => {
    const accountNumber = generateAccountNumber();

    expect(accountNumber).toMatch(/^\d{13}$/);
    expect(hasValidLuhnCheckDigit(accountNumber)).toBe(true);
  });
});
