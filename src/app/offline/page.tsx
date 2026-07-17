import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="offline-page">
      <section className="auth-card">
        <p className="eyebrow">Offline</p>
        <h1>Connection required</h1>
        <p className="muted">BANK NOW never caches balances or money-movement responses for offline use.</p>
        <Link className="primary-button button-link" href="/dashboard">Try again</Link>
      </section>
    </main>
  );
}
