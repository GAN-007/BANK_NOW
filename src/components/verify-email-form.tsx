"use client";

import Link from "next/link";
import { useState } from "react";

import { clientRequest } from "@/lib/client-api";

export function VerifyEmailForm({ token }: { token?: string }) {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">(
    token ? "idle" : "error",
  );
  const [message, setMessage] = useState(
    token ? "Confirm that you want to verify this e-mail address." : "This verification link is incomplete.",
  );

  async function verify() {
    if (!token) {
      return;
    }
    setState("loading");
    setMessage("Verifying your e-mail address...");
    try {
      await clientRequest("/api/auth/verify-email", {
        method: "POST",
        body: { token },
      });
      setState("success");
      setMessage("Your e-mail is verified. You can now sign in.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Verification failed.");
    }
  }

  return (
    <section className="auth-card">
      <p className="eyebrow">Account verification</p>
      <h1>{state === "success" ? "You are verified" : "Verify your e-mail"}</h1>
      <p className={state === "error" ? "form-error" : state === "success" ? "notice" : "muted"}>
        {message}
      </p>
      {state === "idle" && (
        <button className="primary-button" onClick={verify} type="button">
          Verify e-mail
        </button>
      )}
      {(state === "success" || state === "error") && (
        <Link className="primary-button button-link" href="/sign-in">
          Go to sign in
        </Link>
      )}
    </section>
  );
}
