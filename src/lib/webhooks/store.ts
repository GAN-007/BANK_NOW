import { Prisma } from "@/generated/prisma/client";
import type { Provider } from "@/generated/prisma/client";
import { encryptField, hashValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";

export async function beginWebhook(input: {
  provider: Provider;
  externalEventId: string;
  rawPayload: string;
  signatureValid: boolean;
}): Promise<{ id: string; duplicate: boolean }> {
  try {
    const webhook = await getDb().providerWebhook.create({
      data: {
        provider: input.provider,
        externalEventId: input.externalEventId,
        payloadHash: hashValue(input.rawPayload),
        encryptedPayload: encryptField(input.rawPayload),
        signatureValid: input.signatureValid,
      },
    });
    return { id: webhook.id, duplicate: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { id: "", duplicate: true };
    }
    throw error;
  }
}

export async function completeWebhook(
  id: string,
  result: { success: boolean; error?: string },
): Promise<void> {
  await getDb().providerWebhook.update({
    where: { id },
    data: {
      status: result.success ? "PROCESSED" : "FAILED",
      processingError: result.error?.slice(0, 512),
      processedAt: new Date(),
    },
  });
}

export async function rejectWebhook(id: string, error: string): Promise<void> {
  await getDb().providerWebhook.update({
    where: { id },
    data: {
      status: "REJECTED",
      processingError: error.slice(0, 512),
      processedAt: new Date(),
    },
  });
}
