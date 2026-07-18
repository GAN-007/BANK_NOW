"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { type AccountCardData } from "@/components/account-card";
import { clientRequest } from "@/lib/client-api";

export function TransferForm({ accounts }: { accounts: AccountCardData[] }) {
  const [sourceAccountId, setSourceAccountId] = useState(accounts[0]?.id ?? "");
  const [destinationAccountNumber, setDestinationAccountNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recipient, setRecipient] = useState<{
    accountNumber: string;
    displayName: string;
    currency: string;
  } | null>(null);
  const router = useRouter();
  const source = useMemo(
    () => accounts.find((account) => account.id === sourceAccountId),
    [accounts, sourceAccountId],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!source) {
      setError("Select a source account.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const normalizedAccountNumber = destinationAccountNumber.replace(/\s/g, "");
      if (!recipient || recipient.accountNumber !== normalizedAccountNumber) {
        const resolved = await clientRequest<{
          accountNumber: string;
          displayName: string;
          currency: string;
        }>(
          "/api/transfers/recipient?sourceAccountId=" +
            encodeURIComponent(sourceAccountId) +
            "&accountNumber=" +
            encodeURIComponent(normalizedAccountNumber),
        );
        setRecipient(resolved);
        setMessage("Recipient verified. Review the name and select Confirm transfer.");
        return;
      }

      await clientRequest("/api/transfers", {
        method: "POST",
        csrf: true,
        body: {
          sourceAccountId,
          destinationAccountNumber: normalizedAccountNumber,
          amount,
          currency: source.currency,
          memo: memo || undefined,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      setMessage("Transfer posted successfully.");
      setAmount("");
      setMemo("");
      setDestinationAccountNumber("");
      setRecipient(null);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Transfer failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="workflow-card" onSubmit={submit}>
      <h2>Send between BANK NOW accounts</h2>
      <p className="muted">Transfers post only after the ledger locks, checks ownership, and records both sides.</p>
      {message && <p className="notice">{message}</p>}
      {error && <p className="form-error">{error}</p>}
      <label>
        From
        <select
          onChange={(event) => {
            setSourceAccountId(event.target.value);
            setRecipient(null);
          }}
          value={sourceAccountId}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.displayName} · {account.accountNumber}
            </option>
          ))}
        </select>
      </label>
      <label>
        Recipient account number
        <input
          inputMode="numeric"
          maxLength={13}
          minLength={13}
          onChange={(event) => {
            setDestinationAccountNumber(event.target.value);
            setRecipient(null);
          }}
          placeholder="13-digit BANK NOW account number"
          required
          value={destinationAccountNumber}
        />
      </label>
      {recipient && (
        <div className="notice" role="status">
          <strong>Confirm recipient: {recipient.displayName}</strong>
          <br />
          <span>{recipient.accountNumber} · {recipient.currency}</span>
        </div>
      )}
      <div className="form-grid">
        <label>
          Amount
          <input
            inputMode="decimal"
            onChange={(event) => {
              setAmount(event.target.value);
              setRecipient(null);
            }}
            placeholder="0.00"
            required
            value={amount}
          />
        </label>
        <label>
          Currency
          <input disabled value={source?.currency ?? "KES"} />
        </label>
      </div>
      <label>
        Reference note
        <input
          maxLength={140}
          onChange={(event) => {
            setMemo(event.target.value);
            setRecipient(null);
          }}
          placeholder="Optional note"
          value={memo}
        />
      </label>
      <button className="primary-button" disabled={busy || accounts.length === 0} type="submit">
        {busy
          ? recipient
            ? "Posting transfer..."
            : "Verifying recipient..."
          : recipient
            ? "Confirm transfer"
            : "Verify recipient"}
      </button>
    </form>
  );
}
