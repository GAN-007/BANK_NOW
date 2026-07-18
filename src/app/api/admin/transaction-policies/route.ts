import type { NextRequest } from "next/server";

import { requireApiSession, requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { failure, readJson, success } from "@/lib/http";
import { serializeMinor } from "@/lib/money";
import { transactionPolicySchema } from "@/lib/validators";

function serializePolicy(policy: {
  currency: string;
  enabled: boolean;
  maximumAmountMinor: bigint;
  rolling24HourAmountLimitMinor: bigint;
  rolling24HourCountLimit: number;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...policy,
    maximumAmountMinor: serializeMinor(policy.maximumAmountMinor),
    rolling24HourAmountLimitMinor: serializeMinor(
      policy.rolling24HourAmountLimitMinor,
    ),
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession(request);
    requireRole(session.user, ["FINANCE_ADMIN", "PLATFORM_ADMIN"]);
    const policies = await getDb().transactionPolicy.findMany({
      orderBy: { currency: "asc" },
    });
    return success(policies.map(serializePolicy));
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    requireRole(session.user, ["PLATFORM_ADMIN"]);
    const input = await readJson(request, transactionPolicySchema);
    const policy = await getDb().$transaction(async (tx) => {
      const saved = await tx.transactionPolicy.upsert({
        where: { currency: input.currency },
        create: {
          currency: input.currency,
          enabled: input.enabled,
          maximumAmountMinor: BigInt(input.maximumAmountMinor),
          rolling24HourAmountLimitMinor: BigInt(
            input.rolling24HourAmountLimitMinor,
          ),
          rolling24HourCountLimit: input.rolling24HourCountLimit,
          updatedBy: session.user.id,
        },
        update: {
          enabled: input.enabled,
          maximumAmountMinor: BigInt(input.maximumAmountMinor),
          rolling24HourAmountLimitMinor: BigInt(
            input.rolling24HourAmountLimitMinor,
          ),
          rolling24HourCountLimit: input.rolling24HourCountLimit,
          updatedBy: session.user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "TRANSACTION_POLICY_UPDATED",
          resource: "TransactionPolicy",
          resourceId: input.currency,
          outcome: "SUCCESS",
          metadata: {
            currency: input.currency,
            enabled: input.enabled,
            maximumAmountMinor: input.maximumAmountMinor,
            rolling24HourAmountLimitMinor:
              input.rolling24HourAmountLimitMinor,
            rolling24HourCountLimit: input.rolling24HourCountLimit,
          },
        },
      });
      return saved;
    });
    return success(serializePolicy(policy));
  } catch (error) {
    return failure(error);
  }
}
