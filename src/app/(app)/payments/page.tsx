import { ComplianceAlert } from "@/components/compliance-alert";
import { FundingForm } from "@/components/funding-form";
import { PayPalReturnHandler } from "@/components/paypal-return-handler";
import { getCurrentSession } from "@/lib/auth/session";
import { dashboardSnapshot } from "@/lib/activity";
import { listFundingIntents } from "@/lib/payments/service";
import { formatMinorAmount } from "@/lib/money";

export const metadata = {
  title: "Add funds",
};

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session) {
    return null;
  }
  const parameters = await searchParams;
  const [snapshot, paymentIntents] = await Promise.all([
    dashboardSnapshot(session.user.id),
    listFundingIntents(session.user.id),
  ]);

  return (
    <div className="page-stack narrow-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Funding</p>
          <h1>Add funds through a verified path.</h1>
          <p className="muted">A balance is credited only after a provider callback or authorized reconciliation.</p>
        </div>
      </header>
      <ComplianceAlert
        emailVerified={Boolean(session.user.emailVerifiedAt)}
        kycStatus={session.user.kycStatus}
      />
      <FundingForm accounts={snapshot.accounts} />
      {parameters.status === "processing" && <PayPalReturnHandler orderId={parameters.token} />}
      <section className="content-panel">
        <div className="section-heading">
          <div>
            <h2>Funding history</h2>
            <p>Pending entries are not available funds.</p>
          </div>
        </div>
        <div className="payment-history">
          {paymentIntents.length === 0 ? (
            <div className="empty-state"><p>No funding attempts yet.</p></div>
          ) : paymentIntents.map((intent) => (
            <article key={intent.id}>
              <div>
                <strong>{intent.method.replace("_", " ")}</strong>
                <span>{new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(intent.createdAt))}</span>
              </div>
              <div className="payment-history__right">
                <strong>{formatMinorAmount(BigInt(intent.amountMinor), intent.currency)}</strong>
                <span className="status-pill">{intent.status.toLowerCase().replace("_", " ")}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
