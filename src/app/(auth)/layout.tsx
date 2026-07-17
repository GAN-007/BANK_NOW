import Link from "next/link";

export default function AuthenticationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="auth-layout">
      <section className="auth-layout__content">
        <Link className="brand brand--public" href="/">
          <span className="brand-mark">B</span>
          <span>
            <strong>BANK NOW</strong>
            <small>money, clearly</small>
          </span>
        </Link>
        {children}
      </section>
      <aside className="auth-layout__aside">
        <div>
          <p className="eyebrow">Built around controls</p>
          <h2>Modern money movement needs more than a pretty balance screen.</h2>
          <ul>
            <li>Immutable, balanced ledger entries</li>
            <li>Verified provider callbacks before crediting</li>
            <li>Session, MFA, rate-limit, and audit controls</li>
          </ul>
        </div>
      </aside>
    </main>
  );
}
