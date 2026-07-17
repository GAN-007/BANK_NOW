import { AccountCard } from "@/components/account-card";
import { ActivityTable } from "@/components/activity-table";
import { ComplianceAlert } from "@/components/compliance-alert";
import { getCurrentSession } from "@/lib/auth/session";
import { dashboardSnapshot } from "@/lib/activity";
import { formatMinorAmount } from "@/lib/money";

export const metadata = {
  title: "Overview",
};

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) {
    return null;
  }
  const snapshot = await dashboardSnapshot(session.user.id);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Account overview</p>
          <h1>Good day, {session.user.firstName}.</h1>
          <p className="muted">Your available balances and recently posted activity are shown below.</p>
        </div>
        <div className="balance-summary">
          {Object.entries(snapshot.balancesByCurrency).map(([currency, amount]) => (
            <div key={currency}>
              <span>Total available</span>
              <strong>{formatMinorAmount(BigInt(amount), currency)}</strong>
            </div>
          ))}
        </div>
      </header>
      <ComplianceAlert
        emailVerified={Boolean(session.user.emailVerifiedAt)}
        kycStatus={session.user.kycStatus}
      />
      <section>
        <div className="section-heading">
          <div>
            <h2>Your accounts</h2>
            <p>Balances update only after a successful ledger posting.</p>
          </div>
        </div>
        <div className="account-grid">
          {snapshot.accounts.map((account) => <AccountCard account={account} key={account.id} />)}
        </div>
      </section>
      <section className="content-panel">
        <div className="section-heading">
          <div>
            <h2>Recent activity</h2>
            <p>Every row is backed by an immutable journal entry.</p>
          </div>
        </div>
        <ActivityTable rows={snapshot.activity} />
      </section>
    </div>
  );
}
