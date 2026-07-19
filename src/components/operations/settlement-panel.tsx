"use client";

import { BadgeCheck, FileSearch, ShieldAlert } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  type Page,
  type SettlementReview,
  type SettlementReviewDetail,
  type SettlementStatus,
  displayAmount,
  displayDate,
  displayStatus,
  errorMessage,
} from "@/components/operations/types";
import { clientRequest } from "@/lib/client-api";

export function SettlementPanel({ actorId }: { actorId: string }) {
  const [reviews, setReviews] = useState<SettlementReview[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ACTIONABLE" | SettlementStatus>(
    "ACTIONABLE",
  );
  const [detail, setDetail] = useState<SettlementReviewDetail | null>(null);
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
      const page = await clientRequest<Page<SettlementReview>>(
        "/api/admin/settlement-reviews?" + query.toString(),
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
          errorMessage(loadError, "Settlement reviews could not be loaded."),
        );
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [loadReviews]);

  const visibleReviews = useMemo(() => {
    if (filter === "ACTIONABLE") {
      return reviews.filter(
        (review) =>
          review.status === "REQUESTED" || review.status === "APPROVED",
      );
    }
    return reviews.filter((review) => review.status === filter);
  }, [filter, reviews]);

  async function inspect(reviewId: string) {
    setBusy("inspect-" + reviewId);
    setError("");
    setNotice("");
    setRejectionReason("");
    try {
      setDetail(
        await clientRequest<SettlementReviewDetail>(
          "/api/admin/settlement-reviews/" + encodeURIComponent(reviewId),
        ),
      );
    } catch (requestError) {
      setError(
        errorMessage(requestError, "Settlement evidence could not be loaded."),
      );
    } finally {
      setBusy("");
    }
  }

  async function approve() {
    if (!detail) {
      return;
    }
    setBusy("approve");
    setError("");
    setNotice("");
    try {
      await clientRequest(
        "/api/admin/settlement-reviews/" +
          encodeURIComponent(detail.id) +
          "/approve",
        { method: "POST", csrf: true },
      );
      setDetail(null);
      setNotice("Settlement review was approved and executed exactly once.");
      await loadReviews();
    } catch (requestError) {
      setError(errorMessage(requestError, "Settlement approval failed."));
    } finally {
      setBusy("");
    }
  }

  async function reject() {
    if (!detail) {
      return;
    }
    if (rejectionReason.trim().length < 20) {
      setError("Enter a rejection reason of at least 20 characters.");
      return;
    }
    setBusy("reject");
    setError("");
    setNotice("");
    try {
      await clientRequest(
        "/api/admin/settlement-reviews/" +
          encodeURIComponent(detail.id) +
          "/reject",
        {
          method: "POST",
          csrf: true,
          body: { reason: rejectionReason },
        },
      );
      setDetail(null);
      setRejectionReason("");
      setNotice("Settlement review was rejected and retained for audit.");
      await loadReviews();
    } catch (requestError) {
      setError(errorMessage(requestError, "Settlement rejection failed."));
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <section className="content-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Maker/checker</p>
            <h2>Manual settlement reviews</h2>
            <p>
              Inspect external evidence. A requester cannot approve or reject
              their own review.
            </p>
          </div>
          <FileSearch aria-hidden="true" color="#0f766e" size={30} />
        </div>
        <div aria-live="polite">
          {notice && <p className="notice">{notice}</p>}
          {error && <p className="form-error">{error}</p>}
        </div>
        <label className="compact-field">
          Queue filter
          <select
            onChange={(event) =>
              setFilter(event.target.value as typeof filter)
            }
            value={filter}
          >
            <option value="ACTIONABLE">Actionable</option>
            <option value="REQUESTED">Requested</option>
            <option value="APPROVED">Approved, execution pending</option>
            <option value="EXECUTED">Executed</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
        <div className="operations-list">
          {loading && (
            <div className="empty-state" role="status">
              <p>Loading settlement reviews</p>
            </div>
          )}
          {!loading &&
            visibleReviews.map((review) => (
              <article className="operations-item" key={review.id}>
                <div>
                  <div className="button-row">
                    <span className="status-pill">
                      {displayStatus(review.status)}
                    </span>
                    {review.requestedById === actorId && (
                      <span className="status-pill">You requested this</span>
                    )}
                  </div>
                  <h3>
                    {displayAmount(
                      review.paymentIntent.amountMinor,
                      review.paymentIntent.currency,
                    )}{" "}
                    · {displayStatus(review.paymentIntent.provider)}
                  </h3>
                  <p>{review.reason}</p>
                  <small>
                    Requested {displayDate(review.requestedAt)} · Payment{" "}
                    {review.paymentIntentId}
                  </small>
                </div>
                <button
                  className="secondary-button"
                  disabled={busy === "inspect-" + review.id}
                  onClick={() => inspect(review.id)}
                  type="button"
                >
                  {busy === "inspect-" + review.id
                    ? "Loading..."
                    : "Inspect evidence"}
                </button>
              </article>
            ))}
          {!loading && visibleReviews.length === 0 && (
            <div className="empty-state">
              <BadgeCheck aria-hidden="true" size={24} />
              <p>No reviews match this queue.</p>
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
                    "More reviews could not be loaded.",
                  ),
                );
              } finally {
                setBusy("");
              }
            }}
            type="button"
          >
            {busy === "more" ? "Loading..." : "Load more reviews"}
          </button>
        )}
      </section>

      {detail && (
        <section
          aria-label="Settlement evidence"
          className="content-panel evidence-panel"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Sensitive evidence</p>
              <h2>Independently verify before deciding</h2>
              <p>This evidence view has been written to the audit log.</p>
            </div>
            <ShieldAlert aria-hidden="true" color="#b42318" size={30} />
          </div>
          <dl className="operations-details">
            <div>
              <dt>Evidence-system reference</dt>
              <dd>
                <code>{detail.evidenceReference}</code>
              </dd>
            </div>
            <div>
              <dt>Settlement reference</dt>
              <dd>
                <code>{detail.settlementReference}</code>
              </dd>
            </div>
            <div>
              <dt>Provider instruction reference</dt>
              <dd>
                <code>
                  {detail.paymentIntent.providerReference ?? "Not recorded"}
                </code>
              </dd>
            </div>
            <div>
              <dt>Evidence hash</dt>
              <dd>
                <code>{detail.evidenceHash}</code>
              </dd>
            </div>
            <div>
              <dt>Requester identity</dt>
              <dd>
                <code>{detail.requestedById}</code>
              </dd>
            </div>
          </dl>
          {detail.requestedById === actorId && (
            <p className="form-error">
              Separation of duties applies: a different operator must make this
              decision.
            </p>
          )}
          {(detail.status === "REQUESTED" ||
            detail.status === "APPROVED") && (
            <div className="decision-grid">
              <button
                className="primary-button"
                disabled={detail.requestedById === actorId || busy === "approve"}
                onClick={approve}
                type="button"
              >
                {busy === "approve"
                  ? "Executing..."
                  : "Approve and execute credit"}
              </button>
              {detail.status === "REQUESTED" && (
                <div className="workflow-card">
                  <label>
                    Rejection reason
                    <textarea
                      maxLength={500}
                      minLength={20}
                      onChange={(event) =>
                        setRejectionReason(event.target.value)
                      }
                      required
                      rows={4}
                      value={rejectionReason}
                    />
                  </label>
                  <button
                    className="danger-button"
                    disabled={
                      detail.requestedById === actorId || busy === "reject"
                    }
                    onClick={reject}
                    type="button"
                  >
                    {busy === "reject" ? "Rejecting..." : "Reject review"}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}
