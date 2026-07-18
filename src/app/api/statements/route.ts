import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { failure } from "@/lib/http";
import { generateAccountStatement } from "@/lib/statements";
import { statementQuerySchema } from "@/lib/validators";

const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

function dateAtUtcMidnight(value: string): Date {
  const result = new Date(value + "T00:00:00.000Z");
  if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== value) {
    throw new AppError("INVALID_DATE_RANGE", "Choose valid statement dates.", 422);
  }
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession(request);
    const parsed = statementQuerySchema.safeParse({
      accountId: request.nextUrl.searchParams.get("accountId"),
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to"),
    });
    if (!parsed.success) {
      throw new AppError("INVALID_DATE_RANGE", "Choose an account and valid statement dates.", 422);
    }
    const from = dateAtUtcMidnight(parsed.data.from);
    const to = dateAtUtcMidnight(parsed.data.to);
    const toExclusive = new Date(to.getTime() + 24 * 60 * 60 * 1000);
    if (to < from || toExclusive.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw new AppError(
        "INVALID_DATE_RANGE",
        "Statement ranges must be between one day and 366 days.",
        422,
      );
    }

    const statement = await generateAccountStatement({
      userId: session.user.id,
      accountId: parsed.data.accountId,
      from,
      toExclusive,
    });
    await getDb().auditLog.create({
      data: {
        actorId: session.user.id,
        action: "ACCOUNT_STATEMENT_EXPORTED",
        resource: "Account",
        resourceId: parsed.data.accountId,
        outcome: "SUCCESS",
        metadata: {
          from: parsed.data.from,
          to: parsed.data.to,
          rowCount: statement.rowCount,
        },
      },
    });

    return new NextResponse(statement.csv, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition":
          'attachment; filename="BANK-NOW-' +
          statement.accountNumber +
          "-" +
          parsed.data.from +
          "-to-" +
          parsed.data.to +
          '.csv"',
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
