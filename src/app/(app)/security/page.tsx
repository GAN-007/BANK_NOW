import { ComplianceAlert } from "@/components/compliance-alert";
import { KycPanel } from "@/components/kyc-panel";
import { MfaPanel } from "@/components/mfa-panel";
import { SessionManager } from "@/components/session-manager";
import { getCurrentSession } from "@/lib/auth/session";
import { listActiveSessions } from "@/lib/auth/session";

export const metadata = {
  title: "Security",
};

export default async function SecurityPage() {
  const session = await getCurrentSession();
  if (!session) {
    return null;
  }

  const sessions = await listActiveSessions(session.user.id, session.id);

  return (
    <div className="page-stack narrow-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Security centre</p>
          <h1>Protect the account before the money.</h1>
          <p className="muted">Session controls and authenticator MFA are available here.</p>
        </div>
      </header>
      <ComplianceAlert
        emailVerified={Boolean(session.user.emailVerifiedAt)}
        kycStatus={session.user.kycStatus}
      />
      <KycPanel status={session.user.kycStatus} />
      <MfaPanel />
      <SessionManager initialSessions={sessions} />
    </div>
  );
}
