"use client";

import { type FormEvent, useState } from "react";
import Image from "next/image";

import { clientRequest } from "@/lib/client-api";

type MfaEnrollment = {
  qrCodeDataUrl: string;
  manualSecret: string;
  recoveryCodes: string[];
};

export function MfaPanel() {
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError("");
    try {
      setEnrollment(
        await clientRequest<MfaEnrollment>("/api/security/mfa/enrol", {
          method: "POST",
          csrf: true,
        }),
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not begin MFA setup.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await clientRequest("/api/security/mfa/verify", {
        method: "POST",
        csrf: true,
        body: { code },
      });
      setMessage("Authenticator-based MFA is enabled.");
      setEnrollment(null);
      setCode("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not verify the code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workflow-card">
      <h2>Authenticator MFA</h2>
      <p className="muted">Use a TOTP authenticator for a second sign-in factor. Recovery codes are shown exactly once.</p>
      {message && <p className="notice">{message}</p>}
      {error && <p className="form-error">{error}</p>}
      {!enrollment ? (
        <button className="secondary-button" disabled={busy} onClick={start} type="button">
          {busy ? "Preparing..." : "Set up authenticator"}
        </button>
      ) : (
        <form onSubmit={confirm}>
          <Image alt="Scan this QR code in your authenticator app" className="mfa-qr" height={256} src={enrollment.qrCodeDataUrl} unoptimized width={256} />
          <p className="field-hint">Manual secret: <code>{enrollment.manualSecret}</code></p>
          <div className="recovery-codes">
            {enrollment.recoveryCodes.map((recoveryCode) => <code key={recoveryCode}>{recoveryCode}</code>)}
          </div>
          <label>
            Confirm with a six-digit code
            <input autoComplete="one-time-code" inputMode="numeric" onChange={(event) => setCode(event.target.value)} required value={code} />
          </label>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Confirming..." : "Enable MFA"}
          </button>
        </form>
      )}
    </section>
  );
}
