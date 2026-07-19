import { Prisma, WebhookStatus } from "@/generated/prisma/client";
import type { Provider } from "@/generated/prisma/client";
import { encryptField, hashValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { AppError, isAppError } from "@/lib/errors";

const STALE_PROCESSING_MS = 5 * 60 * 1000;

export type WebhookClaim =
  | { id: string; disposition: "claimed" }
  | { id: string; disposition: "processed" | "rejected" | "in_progress" };

function dispositionFor(status: WebhookStatus): WebhookClaim["disposition"] {
  if (status === WebhookStatus.PROCESSED) {
    return "processed";
  }
  if (status === WebhookStatus.REJECTED) {
    return "rejected";
  }
  return "in_progress";
}

/**
 * Claims an event for processing. Failed attempts and stale crashed workers may
 * be reclaimed, while terminal events remain exactly-once. Reusing an event ID
 * with a different payload is rejected as a provider-integrity conflict.
 */
export async function beginWebhook(input: {
  provider: Provider;
  externalEventId: string;
  rawPayload: string;
  signatureValid: boolean;
}): Promise<WebhookClaim> {
  const now = new Date();
  const payloadHash = hashValue(input.rawPayload);
  try {
    const webhook = await getDb().providerWebhook.create({
      data: {
        provider: input.provider,
        externalEventId: input.externalEventId,
        payloadHash,
        encryptedPayload: encryptField(input.rawPayload),
        signatureValid: input.signatureValid,
        lastAttemptAt: now,
        processingStartedAt: now,
      },
    });
    return { id: webhook.id, disposition: "claimed" };
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }
  }

  const existing = await getDb().providerWebhook.findUnique({
    where: {
      provider_externalEventId: {
        provider: input.provider,
        externalEventId: input.externalEventId,
      },
    },
  });
  if (!existing) {
    throw new Error("Webhook uniqueness conflict could not be resolved.");
  }
  if (existing.payloadHash !== payloadHash) {
    await getDb().auditLog.create({
      data: {
        action: "WEBHOOK_EVENT_ID_REUSED",
        resource: "ProviderWebhook",
        resourceId: existing.id,
        outcome: "DENIED",
        metadata: {
          provider: input.provider,
          externalEventId: input.externalEventId,
          originalPayloadHash: existing.payloadHash,
          conflictingPayloadHash: payloadHash,
        },
      },
    });
    throw new AppError(
      "WEBHOOK_EVENT_CONFLICT",
      "This provider event identifier was reused with a different payload.",
      409,
    );
  }
  if (
    existing.status === WebhookStatus.PROCESSED ||
    existing.status === WebhookStatus.REJECTED
  ) {
    return { id: existing.id, disposition: dispositionFor(existing.status) };
  }

  const staleBefore = new Date(now.getTime() - STALE_PROCESSING_MS);
  const reclaimed = await getDb().providerWebhook.updateMany({
    where: {
      id: existing.id,
      OR: [
        { status: WebhookStatus.FAILED },
        {
          status: WebhookStatus.RECEIVED,
          processingStartedAt: { lte: staleBefore },
        },
      ],
    },
    data: {
      status: WebhookStatus.RECEIVED,
      signatureValid: input.signatureValid,
      encryptedPayload: encryptField(input.rawPayload),
      attemptCount: { increment: 1 },
      lastAttemptAt: now,
      processingStartedAt: now,
      processingError: null,
      processedAt: null,
    },
  });
  if (reclaimed.count === 1) {
    return { id: existing.id, disposition: "claimed" };
  }

  const current = await getDb().providerWebhook.findUniqueOrThrow({
    where: { id: existing.id },
    select: { status: true },
  });
  return { id: existing.id, disposition: dispositionFor(current.status) };
}

export function isPermanentWebhookFailure(error: unknown): boolean {
  return isAppError(error) && error.status >= 400 && error.status < 500;
}

export async function completeWebhook(id: string): Promise<void> {
  await getDb().providerWebhook.update({
    where: { id },
    data: {
      status: WebhookStatus.PROCESSED,
      processingError: null,
      processedAt: new Date(),
    },
  });
}

export async function failWebhook(id: string, error: string): Promise<void> {
  await getDb().providerWebhook.update({
    where: { id },
    data: {
      status: WebhookStatus.FAILED,
      processingError: error.slice(0, 512),
      processedAt: new Date(),
    },
  });
}

export async function rejectWebhook(id: string, error: string): Promise<void> {
  await getDb().providerWebhook.update({
    where: { id },
    data: {
      status: WebhookStatus.REJECTED,
      processingError: error.slice(0, 512),
      processedAt: new Date(),
    },
  });
}
