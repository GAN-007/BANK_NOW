"use client";

import { ShieldAlert, SlidersHorizontal } from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  type Policy,
  displayAmount,
  displayDate,
  errorMessage,
} from "@/components/operations/types";
import { clientRequest } from "@/lib/client-api";
import { minorToDecimal, parseMinorAmount } from "@/lib/money";

type PolicyDraft = {
  currency: string;
  enabled: boolean;
  maximumAmount: string;
  rolling24HourAmountLimit: string;
  rolling24HourCountLimit: string;
};

const supportedCurrencies = ["KES", "USD", "EUR", "GBP"] as const;
const emptyDraft: PolicyDraft = {
  currency: "",
  enabled: false,
  maximumAmount: "",
  rolling24HourAmountLimit: "",
  rolling24HourCountLimit: "",
};

export function PolicyPanel({ canConfigure }: { canConfigure: boolean }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [draft, setDraft] = useState<PolicyDraft>(emptyDraft);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadPolicies = useCallback(async () => {
    setPolicies(
      await clientRequest<Policy[]>("/api/admin/transaction-policies"),
    );
  }, []);

  useEffect(() => {
    async function load() {
      try {
        await loadPolicies();
      } catch (loadError) {
        setError(
          errorMessage(loadError, "Transaction policies could not be loaded."),
        );
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [loadPolicies]);

  function edit(policy: Policy) {
    setDraft({
      currency: policy.currency,
      enabled: policy.enabled,
      maximumAmount: minorToDecimal(
        BigInt(policy.maximumAmountMinor),
        policy.currency,
      ),
      rolling24HourAmountLimit: minorToDecimal(
        BigInt(policy.rolling24HourAmountLimitMinor),
        policy.currency,
      ),
      rolling24HourCountLimit: policy.rolling24HourCountLimit.toString(),
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.currency) {
      setError("Choose a supported currency.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const maximumAmountMinor = parseMinorAmount(
        draft.maximumAmount,
        draft.currency,
      );
      const rolling24HourAmountLimitMinor = parseMinorAmount(
        draft.rolling24HourAmountLimit,
        draft.currency,
      );
      const rolling24HourCountLimit = Number(draft.rolling24HourCountLimit);
      if (
        !Number.isInteger(rolling24HourCountLimit) ||
        rolling24HourCountLimit < 1 ||
        rolling24HourCountLimit > 10_000
      ) {
        throw new Error("Rolling transfer count must be between 1 and 10,000.");
      }
      await clientRequest<Policy>("/api/admin/transaction-policies", {
        method: "PUT",
        csrf: true,
        body: {
          currency: draft.currency,
          enabled: draft.enabled,
          maximumAmountMinor: maximumAmountMinor.toString(),
          rolling24HourAmountLimitMinor:
            rolling24HourAmountLimitMinor.toString(),
          rolling24HourCountLimit,
        },
      });
      setDraft(emptyDraft);
      setNotice("The transaction policy was saved and audited.");
      await loadPolicies();
    } catch (requestError) {
      setError(
        errorMessage(requestError, "Transaction policy could not be saved."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="content-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Risk limits</p>
          <h2>Transaction policies</h2>
          <p>
            No limit is invented by the application. Transfers fail closed until
            an approved policy is enabled.
          </p>
        </div>
        <SlidersHorizontal aria-hidden="true" color="#0f766e" size={30} />
      </div>
      <div aria-live="polite">
        {notice && <p className="notice">{notice}</p>}
        {error && <p className="form-error">{error}</p>}
      </div>
      {loading ? (
        <div className="empty-state" role="status">
          <p>Loading transaction policies</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="activity-table">
            <thead>
              <tr>
                <th>Currency</th>
                <th>Status</th>
                <th>Per transfer</th>
                <th>Rolling 24-hour amount</th>
                <th>Rolling count</th>
                <th>Last updated</th>
                {canConfigure && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr key={policy.currency}>
                  <td>
                    <strong>{policy.currency}</strong>
                  </td>
                  <td>{policy.enabled ? "Enabled" : "Disabled"}</td>
                  <td>
                    {displayAmount(
                      policy.maximumAmountMinor,
                      policy.currency,
                    )}
                  </td>
                  <td>
                    {displayAmount(
                      policy.rolling24HourAmountLimitMinor,
                      policy.currency,
                    )}
                  </td>
                  <td>{policy.rolling24HourCountLimit}</td>
                  <td>{displayDate(policy.updatedAt)}</td>
                  {canConfigure && (
                    <td>
                      <button
                        className="secondary-button"
                        onClick={() => edit(policy)}
                        type="button"
                      >
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && policies.length === 0 && (
        <div className="empty-state">
          <ShieldAlert aria-hidden="true" size={24} />
          <p>No transaction policy is configured.</p>
          <span>Customer transfers remain unavailable by design.</span>
        </div>
      )}
      {canConfigure && (
        <form className="operations-form" onSubmit={save}>
          <h3>Set an approved policy</h3>
          <div className="form-grid">
            <label>
              Currency
              <select
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    currency: event.target.value,
                  }))
                }
                required
                value={draft.currency}
              >
                <option disabled value="">
                  Select currency
                </option>
                {supportedCurrencies.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Maximum per transfer
              <input
                inputMode="decimal"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    maximumAmount: event.target.value,
                  }))
                }
                placeholder="Amount in major currency units"
                required
                value={draft.maximumAmount}
              />
            </label>
            <label>
              Rolling 24-hour amount
              <input
                inputMode="decimal"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    rolling24HourAmountLimit: event.target.value,
                  }))
                }
                placeholder="Amount in major currency units"
                required
                value={draft.rolling24HourAmountLimit}
              />
            </label>
            <label>
              Rolling 24-hour transfer count
              <input
                inputMode="numeric"
                max={10000}
                min={1}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    rolling24HourCountLimit: event.target.value,
                  }))
                }
                required
                type="number"
                value={draft.rolling24HourCountLimit}
              />
            </label>
          </div>
          <label className="checkbox-row">
            <input
              checked={draft.enabled}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  enabled: event.target.checked,
                }))
              }
              type="checkbox"
            />
            Enable this policy for customer transfers
          </label>
          <div className="button-row">
            <button
              className="primary-button"
              disabled={saving}
              type="submit"
            >
              {saving ? "Saving..." : "Save audited policy"}
            </button>
            <button
              className="secondary-button"
              onClick={() => setDraft(emptyDraft)}
              type="button"
            >
              Clear
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
