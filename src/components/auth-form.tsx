"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { clientRequest } from "@/lib/client-api";

type SignInResponse =
  | { mfaRequired: false }
  | { mfaRequired: true; challengeToken: string };

type RegistrationResponse = {
  developmentVerificationUrl?: string;
};

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const [currentMode, setCurrentMode] = useState<"form" | "mfa">("form");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (currentMode === "mfa") {
        await clientRequest("/api/auth/mfa", {
          method: "POST",
          body: { challengeToken, code: mfaCode },
        });
        router.replace("/dashboard");
        router.refresh();
        return;
      }

      if (mode === "sign-up") {
        const result = await clientRequest<RegistrationResponse>("/api/auth/register", {
          method: "POST",
          body: {
            firstName,
            lastName,
            email,
            phoneNumber: phoneNumber || undefined,
            password,
          },
        });
        const developmentNote = result.developmentVerificationUrl
          ? " Development link: " + result.developmentVerificationUrl
          : "";
        setMessage("If registration can proceed, check your e-mail for a verification link." + developmentNote);
        return;
      }

      const result = await clientRequest<SignInResponse>("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      if (result.mfaRequired) {
        setChallengeToken(result.challengeToken);
        setCurrentMode("mfa");
        setMessage("Enter the code from your authenticator app.");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (currentMode === "mfa") {
    return (
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">Extra protection</p>
        <h1>Confirm your sign-in</h1>
        <p className="muted">Enter a six-digit authenticator code or an unused recovery code.</p>
        {message && <p className="notice">{message}</p>}
        {error && <p className="form-error">{error}</p>}
        <label>
          Authentication code
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={20}
            onChange={(event) => setMfaCode(event.target.value)}
            required
            value={mfaCode}
          />
        </label>
        <button className="primary-button" disabled={busy} type="submit">
          {busy ? "Confirming..." : "Confirm sign-in"}
        </button>
      </form>
    );
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <p className="eyebrow">{mode === "sign-in" ? "Welcome back" : "Start securely"}</p>
      <h1>{mode === "sign-in" ? "Sign in to BANK NOW" : "Open your BANK NOW account"}</h1>
      <p className="muted">
        {mode === "sign-in"
          ? "Use your verified account to view balances and move money."
          : "Your wallet stays unavailable until you verify your e-mail."}
      </p>
      {message && <p className="notice">{message}</p>}
      {error && <p className="form-error">{error}</p>}
      {mode === "sign-up" && (
        <div className="form-grid">
          <label>
            First name
            <input autoComplete="given-name" onChange={(event) => setFirstName(event.target.value)} required value={firstName} />
          </label>
          <label>
            Last name
            <input autoComplete="family-name" onChange={(event) => setLastName(event.target.value)} required value={lastName} />
          </label>
        </div>
      )}
      <label>
        E-mail address
        <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
      </label>
      {mode === "sign-up" && (
        <label>
          Kenyan phone number
          <input autoComplete="tel" onChange={(event) => setPhoneNumber(event.target.value)} placeholder="2547XXXXXXXX" value={phoneNumber} />
        </label>
      )}
      <label>
        Password
        <input autoComplete={mode === "sign-in" ? "current-password" : "new-password"} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
      </label>
      {mode === "sign-up" && (
        <p className="field-hint">Use 12+ characters with upper-case, lower-case, number, and symbol characters.</p>
      )}
      <button className="primary-button" disabled={busy} type="submit">
        {busy ? "Please wait..." : mode === "sign-in" ? "Sign in" : "Create account"}
      </button>
      {mode === "sign-in" && (
        <p className="auth-switch"><Link href="/forgot-password">Forgot your password?</Link></p>
      )}
      <p className="auth-switch">
        {mode === "sign-in" ? "New to BANK NOW? " : "Already have an account? "}
        <Link href={mode === "sign-in" ? "/sign-up" : "/sign-in"}>
          {mode === "sign-in" ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </form>
  );
}
