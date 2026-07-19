import { requireApiSession, requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { failure, success } from "@/lib/http";
import { runLedgerReconciliation } from "@/lib/operations/reconciliation";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession(request);
    requireRole(session.user, ["FINANCE_ADMIN", "PLATFORM_ADMIN"]);
    const result = await runLedgerReconciliation();
    await getDb().auditLog.create({
      data: {
        actorId: session.user.id,
        action: "LEDGER_RECONCILIATION_RUN",
        resource: "Ledger",
        outcome: result.healthy ? "SUCCESS" : "FAILURE",
        metadata: {
          journalDiscrepancies: result.journalDiscrepancies.length,
          accountDiscrepancies: result.accountDiscrepancies.length,
          truncated: result.truncated,
        },
      },
    });
    return success(result);
  } catch (error) {
    return failure(error);
  }
}
import type { NextRequest } from "next/server";
