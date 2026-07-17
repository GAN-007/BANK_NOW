"use client";

import { type FormEvent, useMemo, useState } from "react";

import { type AccountCardData } from "@/components/account-card";
import { clientRequest } from "@/lib/client-api";

type FundingResponse =
  | {
      kind: "mpesa";
      paymentIntentId: string;
      customerMessage: string;
    }
  | {
      kind: "redirect";
      paymentIntentId: string;
      checkoutUrl: string;
    }
  | {
      kind: "bank_transfer";
      paymentIntentId: string;
      reference: string;
      bankName: string;
      accountName: string;
      accountNumber: string;
      branch?: string;
    };

export function FundingForm({ accounts }: { accounts: AccountCardData[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [method, setMethod] = useState<"MPESA" | "BANK_TRANSFER" | "CARD" | "PAYPAL">("MPESA");
  const [amount, setAmount] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [message, setMessage] = useState("");
  const [instructions, setInstructions] = useState<Extract<FundingResponse, { kind: "bank_transfer" }> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const account = useMemo(
    () => accounts.find((item) => item.id === accountId),
    [accountId, accounts],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) {
      setError("Select an account.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    setInstructions(null);
    try {
      const response = await clientRequest<FundingResponse>("/api/payments/intents", {
        method: "POST",
        csrf: true,
        body: {
          accountId,
          amount,
          currency: account.currency,
          method,
          phoneNumber: method === "MPESA" ? phoneNumber : undefined,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      if (response.kind === "redirect") {
        window.location.assign(response.checkoutUrl);
        return;
      }
      if (response.kind === "bank_transfer") {
        setInstructions(response);
        setMessage("Use the exact reference below. Funds are credited only after finance reconciliation.");
        return;
      }
      setMessage(response.customerMessage);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Funding request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workflow-card">
      <h2>Add funds</h2>
      <p className="muted">M-Pesa is prioritized. Card payments are processed by Stripe; PayPal and bank transfer have their own verified confirmation paths.</p>
      {message && <p className="notice">{message}</p>}
      {error && <p className="form-error">{error}</p>}
      <form onSubmit={submit}>
        <label>
          Fund account
          <select onChange={(event) => setAccountId(event.target.value)} value={accountId}>
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName} · {item.accountNumber}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount
          <input inputMode="decimal" onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required value={amount} />
        </label>
        <fieldset className="payment-methods">
          <legend>Method</legend>
          {[
            ["MPESA", "M-Pesa"],
            ["BANK_TRANSFER", "Bank transfer"],
            ["CARD", "Visa or Mastercard"],
            ["PAYPAL", "PayPal"],
          ].map(([value, label]) => (
            <label className={method === value ? "method-option method-option--selected" : "method-option"} key={value}>
              <input
                checked={method === value}
                name="method"
                onChange={() => setMethod(value as "MPESA" | "BANK_TRANSFER" | "CARD" | "PAYPAL")}
                type="radio"
                value={value}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {method === "MPESA" && (
          <label>
            M-Pesa phone number
            <input inputMode="tel" onChange={(event) => setPhoneNumber(event.target.value)} placeholder="2547XXXXXXXX" required value={phoneNumber} />
          </label>
        )}
        <button className="primary-button" disabled={busy || accounts.length === 0} type="submit">
          {busy ? "Creating payment..." : method === "MPESA" ? "Request M-Pesa prompt" : "Continue to payment"}
        </button>
      </form>
      {instructions && (
        <section className="bank-instructions" aria-live="polite">
          <h3>Bank transfer instructions</h3>
          <dl>
            <div><dt>Bank</dt><dd>{instructions.bankName}</dd></div>
            <div><dt>Account name</dt><dd>{instructions.accountName}</dd></div>
            <div><dt>Account number</dt><dd>{instructions.accountNumber}</dd></div>
            {instructions.branch && <div><dt>Branch</dt><dd>{instructions.branch}</dd></div>}
            <div><dt>Reference</dt><dd><strong>{instructions.reference}</strong></dd></div>
          </dl>
        </section>
      )}
    </div>
  );
}
