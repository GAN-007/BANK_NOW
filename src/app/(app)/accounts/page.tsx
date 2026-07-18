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
  const today = new Date();
  const from = new Date(today.getTime() - 89 * 24 * 60 * 60 * 1000);
  const dateValue = (date: Date) => date.toISOString().slice(0, 10);

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
      <section className="content-panel">
        <div className="section-heading">
          <div>
            <h2>Statements</h2>
            <p>Download up to one year of posted ledger activity as a protected CSV export.</p>
          </div>
        </div>
        <div className="button-row">
          {snapshot.accounts.map((account) => (
            <a
              className="secondary-button"
              href={
                "/api/statements?accountId=" +
                encodeURIComponent(account.id) +
                "&from=" +
                dateValue(from) +
                "&to=" +
                dateValue(today)
              }
              key={account.id}
            >
              Download 90 days · {account.displayName}
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
