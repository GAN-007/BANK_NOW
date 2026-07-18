import { describe, expect, it } from "vitest";

import { csvCell } from "@/lib/statements";

describe("statement CSV safety", () => {
  it("quotes fields, escapes quotes, and neutralizes spreadsheet formulas", () => {
    expect(csvCell('Taxi, "airport"')).toBe('"Taxi, ""airport"""');
    expect(csvCell("=HYPERLINK(\"https://malicious.test\")")).toBe(
      '"\'=HYPERLINK(""https://malicious.test"")"',
    );
    expect(csvCell("+441234")).toBe('"\'+441234"');
  });
});
