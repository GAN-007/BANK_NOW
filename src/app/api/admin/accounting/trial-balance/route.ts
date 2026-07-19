import type { NextRequest } from "next/server";

import { requireApiSession, requireRole } from "@/lib/auth/session";
import { getTrialBalance } from "@/lib/domain/accounting-core";
import { AppError } from "@/lib/errors";
import { failure, success } from "@/lib/http";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession(request);
    requireRole(session.user, ["FINANCE_ADMIN", "PLATFORM_ADMIN"]);
    const periodId = request.nextUrl.searchParams.get("periodId")?.trim();
    if (!periodId) throw new AppError("PERIOD_REQUIRED", "An accounting period is required.", 422);
    return success(await getTrialBalance(periodId));
  } catch (error) {
    return failure(error);
  }
}
