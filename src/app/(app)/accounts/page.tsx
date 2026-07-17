import { AccountCard } from "@/components/account-card";
import { getCurrentSession } from "@/lib/auth/session";
import { dashboardSnapshot } from "@/lib/activity";

export const metadata = {
  title: "Accounts",
};

export default async function AccountsPage() {
  const session = await getCurrentSession();
  if (!session) {
    return null;
  }
  const snapshot = await dashboardSnapshot(session.user.id);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Accounts</p>
          <h1>Money, separated clearly.</h1>
          <p className="muted">Each account has an independent available and ledger balance.</p>
        </div>
      </header>
      <div className="account-grid account-grid--wide">
        {snapshot.accounts.map((account) => <AccountCard account={account} key={account.id} />)}
      </div>
    </div>
  );
}
