import { type KycStatus } from "@/generated/prisma/client";
import { encryptField, hashValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";

type ReviewDecision = Exclude<KycStatus, "NOT_STARTED" | "PENDING">;

export async function decideKycReview(input: {
  actorId: string;
  userId: string;
  status: ReviewDecision;
  provider?: string;
  providerReference?: string;
  rejectionReason?: string;
  ipHash?: string;
}) {
  const provider = input.provider?.trim() || undefined;
  const providerReference = input.providerReference?.trim() || undefined;
  const rejectionReason = input.rejectionReason?.trim() || undefined;
  if (
    input.status === "VERIFIED" &&
    (!provider || !providerReference)
  ) {
    throw new AppError(
      "KYC_EVIDENCE_REQUIRED",
      "Verified identity decisions require an approved workflow and evidence reference.",
      422,
    );
  }
  if (input.status === "REJECTED" && !rejectionReason) {
    throw new AppError(
      "KYC_REJECTION_REASON_REQUIRED",
      "Rejected identity decisions require a reason.",
      422,
    );
  }

  const target = await getDb().user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      role: true,
      kycStatus: true,
      kycProfile: { select: { submittedAt: true } },
    },
  });
  if (!target) {
    throw new AppError("USER_NOT_FOUND", "The account holder was not found.", 404);
  }
  if (target.role !== "CUSTOMER") {
    throw new AppError(
      "KYC_TARGET_NOT_CUSTOMER",
      "Only customer identity cases can be decided through this workflow.",
      422,
    );
  }
  if (target.kycStatus !== "PENDING" && target.kycStatus !== "MANUAL_REVIEW") {
    throw new AppError(
      "KYC_CASE_NOT_REVIEWABLE",
      "This identity case is not awaiting a decision.",
      409,
    );
  }

  const reviewedAt = new Date();
  await getDb().$transaction(async (tx) => {
    const changed = await tx.user.updateMany({
      where: {
        id: input.userId,
        role: "CUSTOMER",
        kycStatus: target.kycStatus,
      },
      data: { kycStatus: input.status },
    });
    if (changed.count !== 1) {
      throw new AppError(
        "KYC_CASE_CHANGED",
        "This identity case changed while it was being reviewed. Refresh the queue.",
        409,
      );
    }

    await tx.kycProfile.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        status: input.status,
        provider,
        encryptedReference: providerReference
          ? encryptField(providerReference)
          : undefined,
        submittedAt: target.kycProfile?.submittedAt ?? reviewedAt,
        reviewedAt,
        reviewedBy: input.actorId,
        rejectionReason:
          input.status === "REJECTED" ? rejectionReason : null,
      },
      update: {
        status: input.status,
        provider,
        encryptedReference: providerReference
          ? encryptField(providerReference)
          : undefined,
        reviewedAt,
        reviewedBy: input.actorId,
        rejectionReason:
          input.status === "REJECTED" ? rejectionReason : null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "KYC_DECISION",
        resource: "User",
        resourceId: input.userId,
        outcome: "SUCCESS",
        ipHash: input.ipHash,
        metadata: {
          status: input.status,
          provider: provider ?? null,
          hasProviderReference: Boolean(providerReference),
          providerReferenceHash: providerReference
            ? hashValue(providerReference)
            : null,
          previousStatus: target.kycStatus,
        },
      },
    });
  });

  return {
    userId: input.userId,
    status: input.status,
    reviewedAt: reviewedAt.toISOString(),
  };
}
