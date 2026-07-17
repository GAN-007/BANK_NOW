import { type AuditOutcome } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

type AuditMetadata = Record<string, boolean | number | string | null>;

export async function writeAudit(input: {
  actorId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  outcome: AuditOutcome;
  ipHash?: string;
  metadata?: AuditMetadata;
}): Promise<void> {
  await getDb().auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      outcome: input.outcome,
      ipHash: input.ipHash,
      metadata: input.metadata,
    },
  });
}

export async function writeAuditSafely(
  input: Parameters<typeof writeAudit>[0],
): Promise<void> {
  try {
    await writeAudit(input);
  } catch (error) {
    console.error("AUDIT_WRITE_FAILED", {
      action: input.action,
      resource: input.resource,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
