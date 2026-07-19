import type { NextRequest } from "next/server";

import { requireApiSession, requireRole } from "@/lib/auth/session";
import { failure, success } from "@/lib/http";
import { getSettlementReviewForDecision } from "@/lib/operations/settlement-review";
import { getDb } from "@/lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireApiSession(request);
    requireRole(session.user, ["FINANCE_ADMIN", "PLATFORM_ADMIN"]);
    const { id } = await context.params;
    const review = await getSettlementReviewForDecision(id);
    await getDb().auditLog.create({
      data: {
        actorId: session.user.id,
        action: "SETTLEMENT_REVIEW_EVIDENCE_VIEWED",
        resource: "SettlementReview",
        resourceId: id,
        outcome: "SUCCESS",
      },
    });
    return success(review);
  } catch (error) {
    return failure(error);
  }
}
