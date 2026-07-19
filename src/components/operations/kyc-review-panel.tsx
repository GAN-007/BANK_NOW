"use client";

import { BadgeCheck } from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  type KycReview,
  type Page,
  displayDate,
  displayStatus,
  errorMessage,
} from "@/components/operations/types";
import { clientRequest } from "@/lib/client-api";

type KycDecision = "" | "MANUAL_REVIEW" | "VERIFIED" | "REJECTED";

export function KycReviewPanel() {
  const [reviews, setReviews] = useState<KycReview[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<KycReview | null>(null);
  const [decision, setDecision] = useState<KycDecision>("");
  const [provider, setProvider] = useState("");
  const [reference, setReference] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  const loadReviews = useCallback(
    async (nextCursor?: string, append = false) => {
      const query = new URLSearchParams({ limit: "50" });
      if (nextCursor) {
        query.set("cursor", nextCursor);
      }
      const page = await clientRequest<Page<KycReview>>(
        "/api/admin/kyc-reviews?" + query.toString(),
      );
      setReviews((current) =>
        append ? [...current, ...page.items] : page.items,
      );
      setCursor(page.nextCursor);
    },
    [],
  );

  useEffect(() => {
    async function load() {
      try {
        await loadReviews();
      } catch (loadError) {
        setError(
          errorMessage(loadError, "Identity review queue could not be loaded."),
        );
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [loadReviews]);

  function beginReview(review: KycReview) {
    setSelected(review);
    setDecision("");
    setProvider(review.kycProfile?.provider ?? "");
    setReference("");
    setRejectionReason("");
    setError("");
    setNotice("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !decision) {
      setError("Choose an identity-review decision.");
      return;
    }
    setBusy("decision");
    setError("");
    setNotice("");
    try {
      await clientRequest(
        "/api/admin/users/" + encodeURIComponent(selected.id) + "/kyc",
        {
          method: "POST",
          csrf: true,
          body: {
            status: decision,
            provider: provider.trim() || undefined,
            providerReference: reference.trim() || undefined,
            rejectionReason: rejectionReason.trim() || undefined,
          },
        },
      );
      setSelected(null);
      setNotice("The identity-review decision was recorded and audited.");
      await loadReviews();
    } catch (requestError) {
      setError(errorMessage(requestError, "Identity-review decision failed."));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="content-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Identity controls</p>
          <h2>KYC review queue</h2>
          <p>
            Record only decisions already supported by an approved external
            provider or controlled manual workflow.
          </p>
        </div>
        <BadgeCheck aria-hidden="true" color="#0f766e" size={30} />
      </div>
      <div aria-live="polite">
        {notice && <p className="notice">{notice}</p>}
        {error && <p className="form-error">{error}</p>}
      </div>
      <div className="operations-list">
        {loading && (
          <div className="empty-state" role="status">
            <p>Loading identity review queue</p>
          </div>
        )}
        {!loading &&
          reviews.map((review) => (
            <article className="operations-item" key={review.id}>
              <div>
                <span className="status-pill">
                  {displayStatus(review.kycStatus)}
                </span>
                <h3>
                  {review.firstName} {review.lastName}
                </h3>
                <p>
                  {review.email}
                  {review.phoneNumber ? " · " + review.phoneNumber : ""}
                </p>
                <small>
                  Submitted{" "}
                  {displayDate(
                    review.kycProfile?.submittedAt ?? review.updatedAt,
                  )}
                  {review.kycProfile?.provider
                    ? " · Workflow: " + review.kycProfile.provider
                    : ""}
                </small>
              </div>
              <button
                className="secondary-button"
                onClick={() => beginReview(review)}
                type="button"
              >
                Record decision
              </button>
            </article>
          ))}
        {!loading && reviews.length === 0 && (
          <div className="empty-state">
            <BadgeCheck aria-hidden="true" size={24} />
            <p>No identity cases are awaiting review.</p>
          </div>
        )}
      </div>
      {cursor && (
        <button
          className="secondary-button"
          disabled={busy === "more"}
          onClick={async () => {
            setBusy("more");
            setError("");
            try {
              await loadReviews(cursor, true);
            } catch (requestError) {
              setError(
                errorMessage(
                  requestError,
                  "More identity cases could not be loaded.",
                ),
              );
            } finally {
              setBusy("");
            }
          }}
          type="button"
        >
          {busy === "more" ? "Loading..." : "Load more identity cases"}
        </button>
      )}
      {selected && (
        <form className="operations-form" onSubmit={submit}>
          <h3>
            Decision for {selected.firstName} {selected.lastName}
          </h3>
          <p className="muted">
            BANK NOW does not collect identity documents here. Verify the
            external case first and store only its reference.
          </p>
          <label>
            Decision
            <select
              onChange={(event) =>
                setDecision(event.target.value as KycDecision)
              }
              required
              value={decision}
            >
              <option disabled value="">
                Select decision
              </option>
              <option value="MANUAL_REVIEW">Keep in manual review</option>
              <option value="VERIFIED">Verified</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </label>
          <div className="form-grid">
            <label>
              Approved provider or workflow
              <input
                maxLength={64}
                onChange={(event) => setProvider(event.target.value)}
                required={decision === "VERIFIED"}
                value={provider}
              />
            </label>
            <label>
              External evidence reference
              <input
                maxLength={256}
                onChange={(event) => setReference(event.target.value)}
                required={decision === "VERIFIED"}
                value={reference}
              />
            </label>
          </div>
          {decision === "REJECTED" && (
            <label>
              Rejection reason
              <textarea
                maxLength={500}
                minLength={4}
                onChange={(event) => setRejectionReason(event.target.value)}
                required
                rows={4}
                value={rejectionReason}
              />
            </label>
          )}
          <div className="button-row">
            <button
              className="primary-button"
              disabled={busy === "decision"}
              type="submit"
            >
              {busy === "decision"
                ? "Recording..."
                : "Record audited decision"}
            </button>
            <button
              className="secondary-button"
              onClick={() => setSelected(null)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
