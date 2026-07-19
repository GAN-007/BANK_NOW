import type { NextRequest } from "next/server";

import { SettlementReviewStatus } from "@/generated/prisma/client";
import { requireApiSession, requireRole } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { failure, success } from "@/lib/http";
import { listSettlementReviews } from "@/lib/operations/settlement-review";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession(request);
    requireRole(session.user, ["FINANCE_ADMIN", "PLATFORM_ADMIN"]);
    const rawStatus = request.nextUrl.searchParams.get("status");
    const status = rawStatus
      ? SettlementReviewStatus[rawStatus as keyof typeof SettlementReviewStatus]
      : undefined;
    if (rawStatus && !status) {
      throw new AppError("VALIDATION_ERROR", "Settlement review status is invalid.", 422);
    }
    const rawLimit = request.nextUrl.searchParams.get("limit");
    const limit = rawLimit ? Number(rawLimit) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      throw new AppError("VALIDATION_ERROR", "Limit must be between 1 and 100.", 422);
    }
    return success(
      await listSettlementReviews({
        status,
        cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
        limit,
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
