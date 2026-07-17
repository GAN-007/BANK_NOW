import { describe, expect, it } from "vitest";

import {
  minorToDecimal,
  parseMinorAmount,
} from "@/lib/money";

describe("money conversion", () => {
  it("converts exact decimal input into integer minor units", () => {
    expect(parseMinorAmount("1,250.50".replace(",", ""), "KES")).toBe(125050n);
    expect(parseMinorAmount("1", "KES")).toBe(100n);
    expect(minorToDecimal(125050n, "KES")).toBe("1250.50");
  });

  it("rejects negative, zero, and over-precise amounts", () => {
    expect(() => parseMinorAmount("-1", "KES")).toThrow("positive amount");
    expect(() => parseMinorAmount("0", "KES")).toThrow("greater than zero");
    expect(() => parseMinorAmount("10.123", "KES")).toThrow("at most two decimal");
  });
});
