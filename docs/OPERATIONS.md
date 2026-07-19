# Operations runbook

## Accounting activation after migration

The ledger fails closed after the extension migration until finance maps posting accounts to governed GL accounts and opens exactly one current accounting period. Currency rows migrate with KES enabled for settlement and USD/EUR/GBP enabled for representation only; settlement enablement must follow approved rail, liquidity, FX, finance, and compliance decisions. JPY and KWD remain disabled to retain zero- and three-decimal metadata without enabling unsupported products.

Period opening/closing, currency changes, GL configuration, pricing activation, reversal authority, reconciliation exceptions, and external-instruction transitions must be exposed only through authenticated finance/platform workflows with separation of duties. Domain services record audit evidence but do not replace organizational approval policy.

Outbox workers claim bounded batches with `FOR UPDATE SKIP LOCKED`, use an unguessable worker identity, and complete only a live owned lease. Alerts must cover backlog age, dead letters, inbox payload conflicts, expired active holds, failed closes, reconciliation aging, and expired active FX quotes.

No provider request runs inside a Prisma ledger transaction. A worker sends committed outbox messages, persists signed provider responses through the inbox boundary, and advances payment instructions only through allowed transitions. `ACCEPTED` never credits settlement; only independently reconciled `SETTLED` evidence may link a posted settlement journal.

This runbook describes the controls implemented by the repository. It does not authorize a production launch or replace the owners/evidence in `PRODUCTION_GATES.md`.

## Release and migrations

1. Build the exact reviewed commit with Node 24 and `npm ci`.
2. Run `npm run prisma:generate`, `npm run check`, `npm audit --audit-level=moderate`, and `npm run build`.
3. Restore a recent production backup into an isolated database, run `npm run prisma:deploy`, then run the integration suite against that database only after renaming it with a `banknow_test` suffix.
4. Review `prisma migrate status` and a schema diff before applying `npm run prisma:deploy` to production from a restricted release identity.
5. Deploy the application only after migration success. Forward-fix a failed migration; never edit a migration that has already reached a shared environment.

The integration suite refuses to truncate a database unless its URL contains `banknow_test`. The committed CI database job starts PostgreSQL 17, deploys every migration, checks schema drift, and exercises concurrency and database triggers.

## Scheduled work

Call `POST /api/internal/maintenance` from the private scheduler with `Authorization: Bearer <OPERATIONS_SECRET>`. Run it at least every five minutes. It:

- expires unfinished payment intents past their deadline;
- releases webhook processing leases abandoned by a crashed worker;
- removes expired sessions, verification/reset tokens, MFA challenges, and rate-limit buckets after their retention windows; and
- writes one summarized system audit event.

Treat non-2xx responses as an incident after bounded scheduler retries. Never place the bearer value in a URL or log it.

## Ledger reconciliation

An authenticated `FINANCE_ADMIN` or `PLATFORM_ADMIN` runs the check in `/operations` or calls `GET /api/admin/reconciliation`. A healthy result requires:

- at least two entries on every posted journal;
- equal debit and credit totals in the journal currency; and
- every account’s stored ledger balance to equal the natural balance calculated from posted entries.

Schedule this check and alert on `healthy: false`, request failure, or a truncated discrepancy result. Freeze affected money movement, preserve logs, and investigate before posting a compensating journal. Never edit a ledger entry.

This internal reconciliation does not match provider payout reports or sponsor-bank statements. Those external files/APIs and their approvals remain a production gate.

## Transaction policies

Transfers are unavailable until a `PLATFORM_ADMIN` writes an enabled policy through `/operations` or `PUT /api/admin/transaction-policies`. The console accepts major currency units and sends exact integer minor units. Every change is audited. Finance roles may read policies but cannot change them.

Policy values must come from approved product, risk, compliance, liquidity, and partner decisions. Review policy changes under dual control outside this application; the implemented maker/checker workflow currently protects manual settlement, not policy edits.

## Manual settlement maker/checker

Manual settlement is never a one-call balance credit:

1. A finance/platform operator posts an idempotent review request to `POST /api/admin/payment-intents/:id/settle` with the external settlement reference, evidence-system reference, and a substantive reason.
2. The evidence-system reference is encrypted; its hash, immutable request identity, requester, and audit event are retained. The payment moves to manual review.
3. A different finance/platform operator uses `/operations` (or the equivalent role-gated review APIs) to inspect the encrypted evidence reference, independently verify it, and approve/execute or reject the review.
4. Approval executes the exactly-once settlement and marks the review executed. The requester is database- and application-blocked from approving or rejecting their own review.

The evidence-view action is audited. The workflow proves separation of identities; it does not prove that the external evidence is genuine. Verify it independently against the sponsor bank/provider report and apply organizational approval thresholds.

## KYC review queue

Compliance/platform operators use the paginated `/operations` queue backed by `GET /api/admin/kyc-reviews`. BANK NOW does not accept identity documents in this console. A `VERIFIED` decision requires the approved provider/workflow name and its external evidence reference; the reference is encrypted and the decision is audited. Case-version compare-and-set logic prevents concurrent reviewers from committing two decisions against the same state. The console records an external decision but does not replace vendor certification, sanctions/PEP checks, AML case management, or dual-control requirements selected by the regulated operating model.

## Webhook incidents

Webhook records use these operational states:

- `RECEIVED`: a worker owns a five-minute processing lease;
- `FAILED`: a transient attempt may be reclaimed on the next provider retry;
- `PROCESSED`: terminal success; and
- `REJECTED`: terminal invalid/mismatched evidence retained for investigation.

Permanent amount/currency/reference mismatches are acknowledged to stop poison retries and route the associated payment to manual review where possible. Transient failures return non-2xx so the provider retries. Reconcile all manual-review cases against provider and bank evidence before a finance-admin settlement.

## Backup, monitoring, and secrets

- Monitor health, database saturation, serialization retries, auth failures, webhook states/age, manual-review intents, reconciliation results, provider latency/error rates, and statement volume.
- Test encrypted backups and point-in-time recovery on a documented cadence. A backup that has not been restored is not evidence of recoverability.
- Rotate `SESSION_PEPPER`, field-encryption material, `OPERATIONS_SECRET`, mail/provider credentials, and database identities under an approved key-migration plan. Current encrypted-field format identifies its version, but decrypting historical rows during key rotation still requires an operational migration.
- Redact M-Pesa callback query strings at the load balancer and restrict that route by network/provider controls because Daraja does not supply the same signed-webhook mechanism used by Stripe and PayPal here.
