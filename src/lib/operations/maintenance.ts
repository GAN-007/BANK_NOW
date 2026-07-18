import { getDb } from "@/lib/db";

export type MaintenanceResult = {
  expiredPaymentIntents: number;
  releasedWebhookClaims: number;
  deletedSessions: number;
  deletedEmailTokens: number;
  deletedPasswordTokens: number;
  deletedMfaChallenges: number;
  deletedRateLimitBuckets: number;
};

export async function runMaintenance(now = new Date()): Promise<MaintenanceResult> {
  const staleWebhookBefore = new Date(now.getTime() - 5 * 60 * 1000);
  const tokenRetentionBefore = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sessionRetentionBefore = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rateLimitRetentionBefore = new Date(now.getTime() - 60 * 60 * 1000);

  return getDb().$transaction(async (tx) => {
    const [
      expiredPaymentIntents,
      releasedWebhookClaims,
      deletedSessions,
      deletedEmailTokens,
      deletedPasswordTokens,
      deletedMfaChallenges,
      deletedRateLimitBuckets,
    ] = await Promise.all([
      tx.paymentIntent.updateMany({
        where: {
          status: { in: ["CREATED", "REQUIRES_ACTION", "PENDING"] },
          expiresAt: { lte: now },
        },
        data: { status: "EXPIRED", failureCode: "INTENT_EXPIRED" },
      }),
      tx.providerWebhook.updateMany({
        where: {
          status: "RECEIVED",
          processingStartedAt: { lte: staleWebhookBefore },
        },
        data: {
          status: "FAILED",
          processingError: "Processing lease expired before completion.",
          processedAt: now,
        },
      }),
      tx.session.deleteMany({
        where: {
          OR: [
            { expiresAt: { lte: sessionRetentionBefore } },
            { revokedAt: { lte: sessionRetentionBefore } },
          ],
        },
      }),
      tx.emailVerificationToken.deleteMany({
        where: { expiresAt: { lte: tokenRetentionBefore } },
      }),
      tx.passwordResetToken.deleteMany({
        where: { expiresAt: { lte: tokenRetentionBefore } },
      }),
      tx.mfaChallenge.deleteMany({
        where: { expiresAt: { lte: tokenRetentionBefore } },
      }),
      tx.rateLimitBucket.deleteMany({
        where: { windowEnds: { lte: rateLimitRetentionBefore } },
      }),
    ]);

    const result = {
      expiredPaymentIntents: expiredPaymentIntents.count,
      releasedWebhookClaims: releasedWebhookClaims.count,
      deletedSessions: deletedSessions.count,
      deletedEmailTokens: deletedEmailTokens.count,
      deletedPasswordTokens: deletedPasswordTokens.count,
      deletedMfaChallenges: deletedMfaChallenges.count,
      deletedRateLimitBuckets: deletedRateLimitBuckets.count,
    };

    await tx.auditLog.create({
      data: {
        action: "SYSTEM_MAINTENANCE_COMPLETED",
        resource: "System",
        outcome: "SUCCESS",
        metadata: result,
      },
    });
    return result;
  });
}
