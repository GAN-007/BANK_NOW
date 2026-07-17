"use client";

import { useState } from "react";

import { clientRequest } from "@/lib/client-api";

type SessionRow = {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
};

export function SessionManager({ initialSessions }: { initialSessions: SessionRow[] }) {
  const [sessions, setSessions] = useState<SessionRow[]>(initialSessions);
  const [error, setError] = useState("");

  async function load() {
    try {
      setSessions(await clientRequest<SessionRow[]>("/api/security/sessions"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load sessions.");
    }
  }

  async function revoke(sessionId: string) {
    try {
      await clientRequest("/api/security/sessions", {
        method: "DELETE",
        csrf: true,
        body: { sessionId },
      });
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not revoke session.");
    }
  }

  return (
    <section className="workflow-card">
      <h2>Active sessions</h2>
      <p className="muted">End any session you do not recognize. The current session is ended only by signing out.</p>
      {error && <p className="form-error">{error}</p>}
      <div className="session-list">
        {sessions.map((session) => (
          <article key={session.id} className="session-row">
            <div>
              <strong>{session.current ? "This device" : "Signed-in device"}</strong>
              <p>{session.userAgent || "Unknown user agent"}</p>
              <small>Last used {new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.lastUsedAt))}</small>
            </div>
            {!session.current && <button className="text-button" onClick={() => revoke(session.id)} type="button">Revoke</button>}
          </article>
        ))}
      </div>
    </section>
  );
}
