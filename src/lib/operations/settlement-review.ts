import { Prisma, SettlementReviewStatus } from "@/generated/prisma/client";
import { decryptField, encryptField, hashValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { settleFundingIntent } from "@/lib/domain/ledger";
import { AppError } from "@/lib/errors";

function reviewRequestHash(input: {
  paymentIntentId: string;
  settlementReference: string;
  evidenceHash: string;
  reason: string;
}): string {
  return hashValue(
    JSON.stringify([
      "settlement-review-v1",
      input.paymentIntentId,
      input.settlementReference,
      input.evidenceHash,
      input.reason,
    ]),
  );
}

function serializeReview(review: {
  id: string;
  paymentIntentId: string;
  settlementReference: string;
  evidenceHash: string;
  reason: string;
  status: SettlementReviewStatus;
  requestedById: string;
  approvedById: string | null;
  rejectedById: string | null;
  rejectionReason: string | null;
  requestedAt: Date;
  approvedAt: Date | null;
  executedAt: Date | null;
  rejectedAt: Date | null;
}) {
  return {
    ...review,
    requestedAt: review.requestedAt.toISOString(),
    approvedAt: review.approvedAt?.toISOString() ?? null,
    executedAt: review.executedAt?.toISOString() ?? null,
    rejectedAt: review.rejectedAt?.toISOString() ?? null,
  };
}

export async function listSettlementReviews(input: {
  status?: SettlementReviewStatus;
  cursor?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const reviews = await getDb().settlementReview.findMany({
    where: input.status ? { status: input.status } : undefined,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: {
      paymentIntent: {
        select: {
          provider: true,
          method: true,
          status: true,
          amountMinor: true,
          currency: true,
          userId: true,
        },
      },
    },
  });
  const hasMore = reviews.length > limit;
  const items = reviews.slice(0, limit).map((review) => ({
    ...serializeReview(review),
    paymentIntent: {
      ...review.paymentIntent,
      amountMinor: review.paymentIntent.amountMinor.toString(),
    },
  }));
  return {
    items,
    nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
  };
}

export async function getSettlementReviewForDecision(reviewId: string) {
  const review = await getDb().settlementReview.findUnique({
    where: { id: reviewId },
    include: {
      paymentIntent: {
        select: {
          provider: true,
          method: true,
          status: true,
          amountMinor: true,
          currency: true,
          userId: true,
          providerReference: true,
        },
      },
    },
  });
  if (!review) {
    throw new AppError("SETTLEMENT_REVIEW_NOT_FOUND", "Settlement review was not found.", 404);
  }
  return {
    ...serializeReview(review),
    evidenceReference: decryptField(review.encryptedEvidenceReference),
    paymentIntent: {
      ...review.paymentIntent,
      amountMinor: review.paymentIntent.amountMinor.toString(),
    },
  };
}

export async function requestSettlementReview(input: {
  paymentIntentId: string;
  requestedById: string;
  idempotencyKey: string;
  settlementReference: string;
  evidenceReference: string;
  reason: string;
}) {
  const evidenceHash = hashValue(input.evidenceReference);
  const requestHash = reviewRequestHash({
    paymentIntentId: input.paymentIntentId,
    settlementReference: input.settlementReference,
    evidenceHash,
    reason: input.reason,
  });
  const existing = await getDb().settlementReview.findUnique({
    where: {
      requestedById_idempotencyKey: {
        requestedById: input.requestedById,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        "This idempotency key was already used for different settlement evidence.",
        409,
      );
    }
    return serializeReview(existing);
  }

  const intent = await getDb().paymentIntent.findUnique({
    where: { id: input.paymentIntentId },
  });
  if (!intent) {
    throw new AppError("PAYMENT_INTENT_NOT_FOUND", "Payment intent was not found.", 404);
  }
  if (intent.status === "SUCCEEDED") {
    throw new AppError("PAYMENT_ALREADY_SETTLED", "This payment is already settled.", 409);
  }

  try {
    const review = await getDb().$transaction(async (tx) => {
      const created = await tx.settlementReview.create({
        data: {
          paymentIntentId: intent.id,
          requestedById: input.requestedById,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          settlementReference: input.settlementReference,
          encryptedEvidenceReference: encryptField(input.evidenceReference),
          evidenceHash,
          reason: input.reason,
        },
      });
      const reserved = await tx.paymentIntent.updateMany({
        where: { id: intent.id, status: { not: "SUCCEEDED" } },
        data: {
          status: "MANUAL_REVIEW",
          failureCode: intent.failureCode ?? "SETTLEMENT_REVIEW_REQUESTED",
        },
      });
      if (reserved.count !== 1) {
        throw new AppError(
          "PAYMENT_ALREADY_SETTLED",
          "This payment was settled before the review could be opened.",
          409,
        );
      }
      await tx.auditLog.create({
        data: {
          actorId: input.requestedById,
          action: "SETTLEMENT_REVIEW_REQUESTED",
          resource: "SettlementReview",
          resourceId: created.id,
          outcome: "SUCCESS",
          metadata: {
            paymentIntentId: intent.id,
            provider: intent.provider,
            settlementReferenceHash: hashValue(input.settlementReference),
            evidenceHash,
          },
        },
      });
      return created;
    });
    return serializeReview(review);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await getDb().settlementReview.findUnique({
        where: {
          requestedById_idempotencyKey: {
            requestedById: input.requestedById,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (raced) {
        if (raced.requestHash !== requestHash) {
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "This idempotency key was already used for different settlement evidence.",
            409,
          );
        }
        return serializeReview(raced);
      }
      throw new AppError(
        "SETTLEMENT_REVIEW_CONFLICT",
        "A review for this settlement evidence already exists.",
        409,
      );
    }
    throw error;
  }
}

export async function approveSettlementReview(input: {
  reviewId: string;
  actorId: string;
}) {
  let review = await getDb().settlementReview.findUnique({
    where: { id: input.reviewId },
  });
  if (!review) {
    throw new AppError("SETTLEMENT_REVIEW_NOT_FOUND", "Settlement review was not found.", 404);
  }
  if (review.requestedById === input.actorId) {
    throw new AppError(
      "SEGREGATION_OF_DUTIES_REQUIRED",
      "A different authorized operator must approve this settlement.",
      403,
    );
  }
  if (review.status === SettlementReviewStatus.REJECTED) {
    throw new AppError("SETTLEMENT_REVIEW_REJECTED", "This review was rejected.", 409);
  }
  if (review.status === SettlementReviewStatus.EXECUTED) {
    return serializeReview(review);
  }

  if (review.status === SettlementReviewStatus.REQUESTED) {
    const approvedAt = new Date();
    const approved = await getDb().$transaction(async (tx) => {
      const changed = await tx.settlementReview.updateMany({
        where: {
          id: review!.id,
          status: SettlementReviewStatus.REQUESTED,
          approvedById: null,
        },
        data: {
          status: SettlementReviewStatus.APPROVED,
          approvedById: input.actorId,
          approvedAt,
        },
      });
      if (changed.count === 1) {
        await tx.auditLog.create({
          data: {
            actorId: input.actorId,
            action: "SETTLEMENT_REVIEW_APPROVED",
            resource: "SettlementReview",
            resourceId: review!.id,
            outcome: "SUCCESS",
          },
        });
      }
      return changed.count;
    });
    review = await getDb().settlementReview.findUniqueOrThrow({
      where: { id: review.id },
    });
    if (approved === 0 && review.status === SettlementReviewStatus.REJECTED) {
      throw new AppError("SETTLEMENT_REVIEW_REJECTED", "This review was rejected.", 409);
    }
    if (review.status === SettlementReviewStatus.EXECUTED) {
      return serializeReview(review);
    }
  }

  if (review.status !== SettlementReviewStatus.APPROVED || !review.approvedById) {
    throw new AppError(
      "SETTLEMENT_REVIEW_NOT_APPROVED",
      "This settlement review is not approved for execution.",
      409,
    );
  }

  await settleFundingIntent({
    paymentIntentId: review.paymentIntentId,
    settlementReference: review.settlementReference,
    allowExpired: true,
    allowManualReview: true,
    actorId: review.approvedById,
    reviewId: review.id,
  });
  const executedAt = new Date();
  const executed = await getDb().$transaction(async (tx) => {
    const changed = await tx.settlementReview.updateMany({
      where: {
        id: review!.id,
        status: SettlementReviewStatus.APPROVED,
      },
      data: {
        status: SettlementReviewStatus.EXECUTED,
        executedAt,
      },
    });
    if (changed.count === 1) {
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "SETTLEMENT_REVIEW_EXECUTED",
          resource: "SettlementReview",
          resourceId: review!.id,
          outcome: "SUCCESS",
          metadata: {
            paymentIntentId: review!.paymentIntentId,
            approvedById: review!.approvedById,
          },
        },
      });
    }
    return tx.settlementReview.findUniqueOrThrow({ where: { id: review!.id } });
  });
  return serializeReview(executed);
}

export async function rejectSettlementReview(input: {
  reviewId: string;
  actorId: string;
  reason: string;
}) {
  const review = await getDb().settlementReview.findUnique({
    where: { id: input.reviewId },
  });
  if (!review) {
    throw new AppError("SETTLEMENT_REVIEW_NOT_FOUND", "Settlement review was not found.", 404);
  }
  if (review.requestedById === input.actorId) {
    throw new AppError(
      "SEGREGATION_OF_DUTIES_REQUIRED",
      "A different authorized operator must reject this settlement review.",
      403,
    );
  }

  const rejectedAt = new Date();
  return getDb().$transaction(async (tx) => {
    const changed = await tx.settlementReview.updateMany({
      where: { id: review.id, status: SettlementReviewStatus.REQUESTED },
      data: {
        status: SettlementReviewStatus.REJECTED,
        rejectedById: input.actorId,
        rejectionReason: input.reason,
        rejectedAt,
      },
    });
    if (changed.count !== 1) {
      throw new AppError(
        "SETTLEMENT_REVIEW_NOT_PENDING",
        "Only a pending settlement review can be rejected.",
        409,
      );
    }
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "SETTLEMENT_REVIEW_REJECTED",
        resource: "SettlementReview",
        resourceId: review.id,
        outcome: "DENIED",
        metadata: { reason: input.reason },
      },
    });
    const rejected = await tx.settlementReview.findUniqueOrThrow({
      where: { id: review.id },
    });
    return serializeReview(rejected);
  });
}
