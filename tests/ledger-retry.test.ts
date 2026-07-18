import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { isRetryableTransactionError } from "@/lib/domain/ledger";

function prismaError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError("database failure", {
    code,
    clientVersion: "test",
    meta,
  });
}

describe("serializable transaction retry classification", () => {
  it("recognizes Prisma and adapter-level concurrency conflicts", () => {
    expect(isRetryableTransactionError(prismaError("P2034"))).toBe(true);
    expect(isRetryableTransactionError(prismaError("P2002"))).toBe(true);
    expect(
      isRetryableTransactionError(
        prismaError("P2010", {
          driverAdapterError: {
            cause: { originalCode: "40001" },
          },
        }),
      ),
    ).toBe(true);
    expect(
      isRetryableTransactionError(
        prismaError("P2010", {
          driverAdapterError: {
            cause: { originalCode: "40P01" },
          },
        }),
      ),
    ).toBe(true);
  });

  it("does not retry integrity violations or unrelated errors", () => {
    expect(
      isRetryableTransactionError(
        prismaError("P2010", {
          driverAdapterError: {
            cause: { originalCode: "23514" },
          },
        }),
      ),
    ).toBe(false);
    expect(isRetryableTransactionError(new Error("network unavailable"))).toBe(
      false,
    );
  });
});
