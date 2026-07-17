import { ComplianceAlert } from "@/components/compliance-alert";
import { TransferForm } from "@/components/transfer-form";
import { getCurrentSession } from "@/lib/auth/session";
import { dashboardSnapshot } from "@/lib/activity";

export const metadata = {
  title: "Transfer",
};

export default async function TransferPage() {
  const session = await getCurrentSession();
  if (!session) {
    return null;
  }
  const snapshot = await dashboardSnapshot(session.user.id);

  return (
    <div className="page-stack narrow-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Internal transfer</p>
          <h1>Send safely, not optimistically.</h1>
          <p className="muted">The transfer request is idempotent and validated again on the server.</p>
        </div>
      </header>
      <ComplianceAlert
        emailVerified={Boolean(session.user.emailVerifiedAt)}
        kycStatus={session.user.kycStatus}
      />
      <TransferForm accounts={snapshot.accounts} />
    </div>
  );
}
