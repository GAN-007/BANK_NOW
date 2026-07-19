import { type NextRequest } from "next/server";

import { requireApiSession, requireRole } from "@/lib/auth/session";
import { hashValue } from "@/lib/crypto";
import { failure, readJson, requestIp, success } from "@/lib/http";
import { decideKycReview } from "@/lib/operations/kyc-review";
import { kycDecisionSchema } from "@/lib/validators";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Internal compliance adjudication endpoint. It accepts only a decision that
 * has already been made through an approved KYC workflow; it is not a public
 * identity-verification substitute.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    requireRole(session.user, ["COMPLIANCE", "PLATFORM_ADMIN"]);
    const input = await readJson(request, kycDecisionSchema);
    const { id: userId } = await context.params;
    return success(
      await decideKycReview({
        actorId: session.user.id,
        userId,
        ...input,
        ipHash: hashValue(requestIp(request)),
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
