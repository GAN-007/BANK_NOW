import type { NextRequest } from "next/server";

import { KycStatus, UserRole } from "@/generated/prisma/client";
import { requireApiSession, requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { failure, success } from "@/lib/http";

const reviewableStatuses: KycStatus[] = [
  KycStatus.PENDING,
  KycStatus.MANUAL_REVIEW,
];

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession(request);
    requireRole(session.user, ["COMPLIANCE", "PLATFORM_ADMIN"]);

    const rawStatus = request.nextUrl.searchParams.get("status");
    const status = rawStatus
      ? KycStatus[rawStatus as keyof typeof KycStatus]
      : undefined;
    if (status && !reviewableStatuses.includes(status)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Only pending or manual-review identity cases can be queued.",
        422,
      );
    }
    if (rawStatus && !status) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Identity-review status is invalid.",
        422,
      );
    }

    const rawLimit = request.nextUrl.searchParams.get("limit");
    const limit = rawLimit ? Number(rawLimit) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Limit must be between 1 and 100.",
        422,
      );
    }
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    if (cursor && cursor.length > 64) {
      throw new AppError("VALIDATION_ERROR", "Cursor is invalid.", 422);
    }

    const users = await getDb().user.findMany({
      where: {
        role: UserRole.CUSTOMER,
        kycStatus: status ?? { in: reviewableStatuses },
      },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        kycStatus: true,
        createdAt: true,
        updatedAt: true,
        kycProfile: {
          select: {
            provider: true,
            submittedAt: true,
            updatedAt: true,
          },
        },
      },
    });
    const hasMore = users.length > limit;
    const page = users.slice(0, limit);
    const items = page.map((user) => ({
      ...user,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      kycProfile: user.kycProfile
        ? {
            ...user.kycProfile,
            submittedAt: user.kycProfile.submittedAt?.toISOString() ?? null,
            updatedAt: user.kycProfile.updatedAt.toISOString(),
          }
        : null,
    }));

    await getDb().auditLog.create({
      data: {
        actorId: session.user.id,
        action: "KYC_REVIEW_QUEUE_VIEWED",
        resource: "KycProfile",
        outcome: "SUCCESS",
        metadata: {
          status: status ?? "ALL_REVIEWABLE",
          returnedCount: items.length,
          hasMore,
        },
      },
    });

    return success({
      items,
      nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
    });
  } catch (error) {
    return failure(error);
  }
}
