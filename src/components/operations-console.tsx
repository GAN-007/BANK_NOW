"use client";

import { KycReviewPanel } from "@/components/operations/kyc-review-panel";
import { PolicyPanel } from "@/components/operations/policy-panel";
import { ReconciliationPanel } from "@/components/operations/reconciliation-panel";
import { SettlementPanel } from "@/components/operations/settlement-panel";
import {
  type StaffRole,
  displayStatus,
} from "@/components/operations/types";

export function OperationsConsole({
  actorId,
  role,
}: {
  actorId: string;
  role: StaffRole;
}) {
  const canFinance = role === "FINANCE_ADMIN" || role === "PLATFORM_ADMIN";
  const canReviewKyc = role === "COMPLIANCE" || role === "PLATFORM_ADMIN";

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Controlled operations</p>
          <h1>Review evidence before changing financial state.</h1>
          <p className="muted">
            Your role is {displayStatus(role)}. Every sensitive read and decision
            is permission-checked and audit-linked.
          </p>
        </div>
      </header>

      {canFinance && (
        <>
          <ReconciliationPanel />
          <SettlementPanel actorId={actorId} />
          <PolicyPanel canConfigure={role === "PLATFORM_ADMIN"} />
        </>
      )}
      {canReviewKyc && <KycReviewPanel />}
    </div>
  );
}
