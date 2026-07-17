"use client";

import { useState } from "react";

import { clientRequest } from "@/lib/client-api";

export function PayPalReturnHandler({ orderId }: { orderId?: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!orderId) {
    return null;
  }

  async function confirmCapture() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await clientRequest<{ message: string }>("/api/payments/paypal/capture", {
        method: "POST",
        csrf: true,
        body: { orderId },
      });
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "PayPal confirmation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content-panel payment-return" aria-live="polite">
      <h2>Finish your PayPal payment</h2>
      <p className="muted">Confirm the approved order, then wait for the verified PayPal webhook before the funds become available.</p>
      {message && <p className="notice">{message}</p>}
      {error && <p className="form-error">{error}</p>}
      <button className="primary-button" disabled={busy || Boolean(message)} onClick={confirmCapture} type="button">
        {busy ? "Confirming with PayPal..." : "Confirm PayPal payment"}
      </button>
    </section>
  );
}
