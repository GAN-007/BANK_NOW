import type { NextRequest } from "next/server";

import { requireApiSession, requireRole } from "@/lib/auth/session";
import { closeAccountingPeriod } from "@/lib/domain/accounting-core";
import { failure, success } from "@/lib/http";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    requireRole(session.user, ["FINANCE_ADMIN", "PLATFORM_ADMIN"]);
    const { id } = await context.params;
    return success(await closeAccountingPeriod({ periodId: id, actorId: session.user.id }));
  } catch (error) {
    return failure(error);
  }
}
