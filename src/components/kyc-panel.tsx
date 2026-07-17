"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";

import { clientRequest } from "@/lib/client-api";

export function KycPanel({ status }: { status: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const actionable = status === "NOT_STARTED" || status === "REJECTED";

  async function requestReview() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await clientRequest<{ message: string }>("/api/kyc/request", {
        method: "POST",
        csrf: true,
      });
      setMessage(result.message);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not request identity review.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content-panel kyc-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Identity verification</p>
          <h2>Keep money movement protected.</h2>
          <p className="muted">Status: {status.toLowerCase().replaceAll("_", " ")}</p>
        </div>
        <ShieldCheck aria-hidden="true" color="#0f766e" size={30} />
      </div>
      <p className="muted">Document collection and verification must happen through an approved, secure KYC workflow. Do not send identity documents by e-mail or chat.</p>
      {message && <p className="notice">{message}</p>}
      {error && <p className="form-error">{error}</p>}
      {actionable && (
        <button className="secondary-button" disabled={busy} onClick={requestReview} type="button">
          {busy ? "Requesting review..." : "Request identity review"}
        </button>
      )}
    </section>
  );
}
