import { type NextRequest } from "next/server";

import {
  requireApiSession,
  requireRole,
} from "@/lib/auth/session";
import { failure, readJson, success } from "@/lib/http";
import { requestSettlementReview } from "@/lib/operations/settlement-review";
import { settlementReviewRequestSchema } from "@/lib/validators";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    requireRole(session.user, ["FINANCE_ADMIN", "PLATFORM_ADMIN"]);
    const input = await readJson(request, settlementReviewRequestSchema);
    const { id } = await context.params;
    const review = await requestSettlementReview({
      paymentIntentId: id,
      requestedById: session.user.id,
      ...input,
    });
    return success(review, 202);
  } catch (error) {
    return failure(error);
  }
}
