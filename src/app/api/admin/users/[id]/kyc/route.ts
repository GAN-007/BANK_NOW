import { type NextRequest } from "next/server";

import { AuditOutcome } from "@/generated/prisma/client";
import { requireApiSession, requireRole } from "@/lib/auth/session";
import { encryptField, hashValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { failure, readJson, requestIp, success } from "@/lib/http";
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
    const target = await getDb().user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!target) {
      throw new AppError("USER_NOT_FOUND", "The account holder was not found.", 404);
    }

    const reviewedAt = input.status === "PENDING" ? null : new Date();
    await getDb().$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { kycStatus: input.status },
      });
      await tx.kycProfile.upsert({
        where: { userId },
        create: {
          userId,
          status: input.status,
          provider: input.provider,
          encryptedReference: input.providerReference
            ? encryptField(input.providerReference)
            : undefined,
          submittedAt: input.status === "PENDING" ? new Date() : undefined,
          reviewedAt: reviewedAt ?? undefined,
          reviewedBy: reviewedAt ? session.user.id : undefined,
          rejectionReason: input.status === "REJECTED" ? input.rejectionReason : null,
        },
        update: {
          status: input.status,
          provider: input.provider,
          encryptedReference: input.providerReference
            ? encryptField(input.providerReference)
            : undefined,
          submittedAt: input.status === "PENDING" ? new Date() : undefined,
          reviewedAt,
          reviewedBy: reviewedAt ? session.user.id : null,
          rejectionReason: input.status === "REJECTED" ? input.rejectionReason : null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "KYC_DECISION",
          resource: "user",
          resourceId: userId,
          outcome: AuditOutcome.SUCCESS,
          ipHash: hashValue(requestIp(request)),
          metadata: {
            status: input.status,
            provider: input.provider ?? null,
            hasProviderReference: Boolean(input.providerReference),
          },
        },
      });
    });

    return success({ userId, status: input.status });
  } catch (error) {
    return failure(error);
  }
}
