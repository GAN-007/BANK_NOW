import { type NextRequest } from "next/server";

import { AuditOutcome, KycStatus } from "@/generated/prisma/client";
import { requireApiSession } from "@/lib/auth/session";
import { hashValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { failure, requestIp, success } from "@/lib/http";

/**
 * Records consent to begin the approved KYC process without collecting an ID
 * document or other sensitive data in this application. The configured KYC
 * provider/manual workflow owns evidence collection and verification.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    const currentStatus = session.user.kycStatus;
    if (currentStatus === KycStatus.VERIFIED) {
      return success({ status: currentStatus, message: "Identity verification is already complete." });
    }
    if (currentStatus === KycStatus.PENDING || currentStatus === KycStatus.MANUAL_REVIEW) {
      return success({ status: currentStatus, message: "Your identity review is already in progress." });
    }

    const submittedAt = new Date();
    await getDb().$transaction(async (tx) => {
      await tx.user.update({
        where: { id: session.user.id },
        data: { kycStatus: KycStatus.PENDING },
      });
      await tx.kycProfile.upsert({
        where: { userId: session.user.id },
        create: {
          userId: session.user.id,
          status: KycStatus.PENDING,
          submittedAt,
        },
        update: {
          status: KycStatus.PENDING,
          submittedAt,
          reviewedAt: null,
          reviewedBy: null,
          rejectionReason: null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "KYC_REVIEW_REQUESTED",
          resource: "user",
          resourceId: session.user.id,
          outcome: AuditOutcome.SUCCESS,
          ipHash: hashValue(requestIp(request)),
        },
      });
    });

    return success({
      status: KycStatus.PENDING,
      message: "Your identity review request was recorded. Follow the approved verification instructions from BANK NOW.",
    });
  } catch (error) {
    return failure(error);
  }
}
