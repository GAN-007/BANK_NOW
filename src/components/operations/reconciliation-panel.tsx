"use client";

import { RefreshCw, Scale } from "lucide-react";
import { useState } from "react";

import {
  type Reconciliation,
  displayAmount,
  displayDate,
  displayStatus,
  errorMessage,
} from "@/components/operations/types";
import { clientRequest } from "@/lib/client-api";

export function ReconciliationPanel() {
  const [result, setResult] = useState<Reconciliation | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function runReconciliation() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await clientRequest<Reconciliation>(
        "/api/admin/reconciliation",
      );
      setResult(response);
      setNotice(
        response.healthy
          ? "Ledger projections and posted journals reconcile."
          : "Reconciliation found discrepancies. Freeze affected movement and investigate.",
      );
    } catch (requestError) {
      setError(errorMessage(requestError, "Reconciliation could not be run."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Ledger control</p>
          <h2>Projection reconciliation</h2>
          <p>
            Compare posted journal arithmetic with every stored account balance.
          </p>
        </div>
        <Scale aria-hidden="true" color="#0f766e" size={30} />
      </div>
      <div aria-live="polite">
        {notice && <p className="notice">{notice}</p>}
        {error && <p className="form-error">{error}</p>}
      </div>
      <button
        className="secondary-button"
        disabled={busy}
        onClick={runReconciliation}
        type="button"
      >
        <RefreshCw aria-hidden="true" size={17} />
        {busy ? "Reconciling..." : "Run reconciliation"}
      </button>
      {result && (
        <div className="operations-result">
          <div className="metric-grid">
            <div className="metric-card">
              <span>Result</span>
              <strong>{result.healthy ? "Healthy" : "Investigate"}</strong>
            </div>
            <div className="metric-card">
              <span>Journal discrepancies</span>
              <strong>{result.journalDiscrepancies.length}</strong>
            </div>
            <div className="metric-card">
              <span>Account discrepancies</span>
              <strong>{result.accountDiscrepancies.length}</strong>
            </div>
          </div>
          <p className="muted">
            Checked {displayDate(result.checkedAt)}
            {result.truncated
              ? ". Results were truncated; escalate immediately."
              : "."}
          </p>
          {result.journalDiscrepancies.length > 0 && (
            <div className="table-scroll">
              <table className="activity-table">
                <thead>
                  <tr>
                    <th>Journal</th>
                    <th>Entries</th>
                    <th>Debits</th>
                    <th>Credits</th>
                    <th>Currency mismatches</th>
                  </tr>
                </thead>
                <tbody>
                  {result.journalDiscrepancies.map((item) => (
                    <tr key={item.id}>
                      <td>{item.reference}</td>
                      <td>{item.entryCount}</td>
                      <td>
                        {displayAmount(item.debitTotalMinor, item.currency)}
                      </td>
                      <td>
                        {displayAmount(item.creditTotalMinor, item.currency)}
                      </td>
                      <td>{item.currencyMismatchCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.accountDiscrepancies.length > 0 && (
            <div className="table-scroll">
              <table className="activity-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Class</th>
                    <th>Stored</th>
                    <th>Calculated</th>
                  </tr>
                </thead>
                <tbody>
                  {result.accountDiscrepancies.map((item) => (
                    <tr key={item.id}>
                      <td>{item.accountNumber}</td>
                      <td>{displayStatus(item.ledgerClass)}</td>
                      <td>
                        {displayAmount(item.storedBalanceMinor, item.currency)}
                      </td>
                      <td>
                        {displayAmount(
                          item.calculatedBalanceMinor,
                          item.currency,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
