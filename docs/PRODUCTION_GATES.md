# Production gates

This repository is deliberately explicit about the work that code cannot complete. All gates below require named owners and documented approval before accepting real money or customer data.

## Regulatory and partner readiness

- Obtain the required banking, payment-service, money-transmitter, data-protection, and consumer-disclosure approvals for every jurisdiction served.
- Contract with a regulated sponsor bank/payment institution, Safaricom/Daraja, Stripe, PayPal, and any KYC/AML provider as applicable.
- Define safeguarding/segregation of customer funds, settlement timing, fees, refunds, chargebacks, reversals, disputes, limits, and customer support escalation.
- Complete AML/CFT, sanctions, fraud-monitoring, transaction-monitoring, record-retention, and suspicious-activity operating procedures.
- Integrate an approved KYC vendor or verified manual-review workflow before any compliance user marks an account `VERIFIED`.

## Security and privacy readiness

- Perform an independent threat model, code review, dependency scan, penetration test, and remediation review.
- Rotate all historical source-control credentials. Do not reuse tutorial, sandbox, demo, or local secrets.
- Keep production secrets in a managed KMS/secret manager with rotation, access review, and break-glass controls.
- Define encryption-key lifecycle, incident response, vulnerability disclosure, DPIA/privacy notices, data-subject procedures, retention, deletion, and encrypted backups.
- Enforce SSO/MFA, least-privilege role assignment, and audit-log review/retention. The included manual-settlement flow enforces two distinct operators; extend maker/checker control to policy changes, KYC overrides, reversals, refunds, role assignment, and other privileged finance actions.

## Financial integrity readiness

- Approve and configure per-currency limits in `TransactionPolicy`; add customer/risk-tier velocity rules, beneficiary cooling periods, fraud scoring, sanctions screening, and risk-based step-up authentication. The code fails closed when a base currency policy is absent, but it cannot choose the business limits.
- Schedule the included projection/journal reconciliation and maintenance endpoints. Add ingestion/matching for signed provider settlement reports and sponsor-bank statements, then alert on unmatched or stale funding intents.
- Establish controlled reversal/refund/chargeback workflows that post compensating journal entries rather than changing history.
- Load-test concurrent transfers, provider retries, and webhook ordering with real partner sandboxes.
- Restrict M-Pesa callbacks at the edge, protect the callback secret from proxy/application logs, and independently reconcile callback outcomes with Safaricom settlement/status reports.

## Reliability readiness

- Provision HA PostgreSQL, tested point-in-time recovery, least-privilege service accounts, TLS, WAF/DDoS controls, and geographically appropriate data residency.
- Monitor database availability, webhook failure/retry queue, ledger imbalance, provider error rate, suspicious auth events, migration status, and service-level objectives.
- Run migrations in a reviewed release process and verify rollback/forward-fix procedures.
- Configure a 24/7 incident/on-call model for payment and fraud events before launch.

## Release evidence still required

- Apply both committed migrations to a disposable production-like database, run `npm run test:integration`, and archive the successful migration/drift output. CI provides this gate for pull requests, but it is not evidence for an undisclosed production database.
- Record backup/restore and point-in-time-recovery exercises, capacity/load results, provider sandbox certification, accessibility/browser testing, penetration-test remediation, and key-rotation exercises.
- Populate real credentials only in the approved secret manager. No live credential was supplied to or written by this repository audit.
- Obtain written legal, compliance, sponsor-bank, KYC/AML, privacy, and provider approvals. No code commit or automated test constitutes regulatory readiness.

Completion of these gates should be represented by formal evidence, not a checkbox in code.
