"use client";

export default function ApplicationError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="auth-layout">
      <section className="auth-layout__content">
        <div className="auth-card">
          <p className="eyebrow">Something needs attention</p>
          <h1>We could not load that securely.</h1>
          <p className="muted">No money movement was completed by this error. Refresh the page or try again shortly.</p>
          <button className="primary-button" onClick={reset} type="button">Try again</button>
        </div>
      </section>
    </main>
  );
}
