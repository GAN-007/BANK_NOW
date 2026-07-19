import { describe, expect, it } from "vitest";

import { normalizeKenyanPhoneNumber } from "@/lib/phone";

describe("Kenyan phone normalization", () => {
  it("stores local and international mobile formats canonically", () => {
    expect(normalizeKenyanPhoneNumber("0712 345 678")).toBe("254712345678");
    expect(normalizeKenyanPhoneNumber("+254 (112) 345-678")).toBe("254112345678");
  });

  it("rejects non-mobile and malformed values", () => {
    expect(() => normalizeKenyanPhoneNumber("+1 202 555 0100")).toThrow(
      "Kenyan mobile number",
    );
  });
});
