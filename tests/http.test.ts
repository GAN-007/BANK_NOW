import { describe, expect, it } from "vitest";

import { readRawText } from "@/lib/http";

describe("bounded request bodies", () => {
  it("reads an in-range UTF-8 body exactly", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: "M-Pesa ✓",
    });
    await expect(readRawText(request, 32)).resolves.toBe("M-Pesa ✓");
  });

  it("rejects a body beyond the configured byte limit", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: "123456",
    });
    await expect(readRawText(request, 5)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
    });
  });
});
