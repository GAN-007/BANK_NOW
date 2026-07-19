import type { NextRequest } from "next/server";

import { requireApiSession, requireRole } from "@/lib/auth/session";
import { failure, readJson, success } from "@/lib/http";
import { rejectSettlementReview } from "@/lib/operations/settlement-review";
import { settlementReviewRejectionSchema } from "@/lib/validators";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    requireRole(session.user, ["FINANCE_ADMIN", "PLATFORM_ADMIN"]);
    const input = await readJson(request, settlementReviewRejectionSchema);
    const { id } = await context.params;
    return success(
      await rejectSettlementReview({
        reviewId: id,
        actorId: session.user.id,
        reason: input.reason,
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
