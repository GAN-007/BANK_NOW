"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { clientRequest } from "@/lib/client-api";

export function PasswordRecoveryForm({ token }: { token?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isReset = Boolean(token);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (isReset) {
        const result = await clientRequest<{ message: string }>("/api/auth/reset-password", {
          method: "POST",
          body: { token, password },
        });
        setMessage(result.message);
      } else {
        const result = await clientRequest<{
          message: string;
          developmentResetUrl?: string;
        }>("/api/auth/request-password-reset", {
          method: "POST",
          body: { email },
        });
        setMessage(
          result.message +
            (result.developmentResetUrl ? " Development link: " + result.developmentResetUrl : ""),
        );
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <p className="eyebrow">Account recovery</p>
      <h1>{isReset ? "Choose a new password" : "Reset your password"}</h1>
      <p className="muted">
        {isReset
          ? "Use 12+ characters with upper-case, lower-case, number, and symbol characters. Existing sessions will be signed out."
          : "Enter the verified e-mail address on your account. We will send a secure, time-limited link if it exists."}
      </p>
      {message && <p className="notice">{message}</p>}
      {error && <p className="form-error">{error}</p>}
      {isReset ? (
        <label>
          New password
          <input autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
        </label>
      ) : (
        <label>
          E-mail address
          <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
        </label>
      )}
      {!message && (
        <button className="primary-button" disabled={busy} type="submit">
          {busy ? "Please wait..." : isReset ? "Reset password" : "Send reset link"}
        </button>
      )}
      <p className="auth-switch"><Link href="/sign-in">Back to sign in</Link></p>
    </form>
  );
}
