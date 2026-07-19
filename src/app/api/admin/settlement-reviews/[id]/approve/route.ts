import type { NextRequest } from "next/server";

import { requireApiSession, requireRole } from "@/lib/auth/session";
import { failure, success } from "@/lib/http";
import { approveSettlementReview } from "@/lib/operations/settlement-review";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    requireRole(session.user, ["FINANCE_ADMIN", "PLATFORM_ADMIN"]);
    const { id } = await context.params;
    return success(
      await approveSettlementReview({
        reviewId: id,
        actorId: session.user.id,
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
