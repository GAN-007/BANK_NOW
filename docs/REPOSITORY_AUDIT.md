# BANK NOW repository audit

## Scope and evidence

This audit was performed on 18 July 2026 through the connected GitHub repository and a clean checkout of `GAN-007/BANK_NOW`. The baseline default-branch commit was `7d75f52d76c0564788fa386765da67a81d90e33e`. All 112 tracked files, every tracked directory, all five branches, the visible commit history, repository metadata, workflows, dependency graph, issues, and pull requests were inventoried. There were no open issues or pull requests.

The review traced request paths from UI forms through validation, sessions/RBAC, services, Prisma transactions, provider clients/callbacks, migrations, tests, Docker, PWA assets, CI, and documentation. It also ran a clean dependency install, generated Prisma, linted, type-checked, ran unit tests, built the baseline, and audited dependencies. This environment did not expose PostgreSQL or Docker, so no claim is made that a real database was migrated locally. The hardened CI workflow now performs that missing database gate.

## Branches

| Branch | Relationship to audited `main` | Assessment |
| --- | --- | --- |
| `main` | Default branch | Functional baseline; contained seven unit tests and no database-backed CI before this hardening. |
| `dependabot/github_actions/actions/checkout-7` | One branch commit, three commits behind `main` | Do not merge. It proposes `v7`, while the official action’s current supported release is v6. The hardened workflow pins verified `v6.0.2` by commit SHA. |
| `dependabot/github_actions/actions/setup-node-7` | One branch commit, three commits behind `main` | Do not merge. It proposes `v7`, while the official action’s current release is v6. The hardened workflow pins verified `v6.4.0` by commit SHA. |
| `dependabot/npm_and_yarn/eslint-10.7.0` | One branch commit, two commits behind `main` | Do not merge as-is. ESLint 10 is outside the declared TypeScript-ESLint 8 toolchain peer range. Upgrade only as one tested lint-toolchain change. |
| `dependabot/npm_and_yarn/typescript-7.0.2` | One branch commit, two commits behind `main` | Do not merge as-is. TypeScript 7 is outside the currently supported parser/toolchain range. Upgrade only after TypeScript-ESLint and Next explicitly support it. |

The v6 action releases were verified against the official [`actions/checkout`](https://github.com/actions/checkout/releases) and [`actions/setup-node`](https://github.com/actions/setup-node/releases) repositories. The four stale branches were left intact because deleting user branches is not required to harden `main`.

## File and folder assessment

| Area | Files reviewed | Findings |
| --- | --- | --- |
| Repository/config | `.env.example`, `.gitignore`, `package*.json`, TypeScript/ESLint/Next/PostCSS/Prisma/Vitest configs, license | Strict TypeScript and linting were enabled. React/ReactDOM were only transitive and are now explicit runtime dependencies. Runtime proxy/operations configuration is now validated. |
| Delivery | `Dockerfile`, `docker-compose.yml`, `.github/workflows/*`, Dependabot | Multi-stage non-root image and health check were sound. CI lacked a database; it now pins actions, applies migrations, checks drift, tests PostgreSQL concurrency/triggers, builds, and audits all dependencies. |
| Database | Prisma schema, seed, both migrations | The baseline modeled users, sessions, MFA, KYC, accounts, journals, entries, transfers, intents, webhooks, audit, and rate limits. The new migration adds database checks, posting-time balancing, append-only entries, immutable financial identity, webhook leases, settlement IDs, anti-replay state, and transaction policy. |
| App routes | Every page/layout/error/offline/manifest file | Customer auth, dashboard, accounts, transfer, funding, security, KYC, and PWA paths were complete for the represented scope. Recipient confirmation and statement export were missing and are now exposed. A server/API-role-gated staff operations console now covers the implemented finance, policy, reconciliation, and compliance workflows. |
| API routes | Every auth/account/KYC/payment/security/transfer/webhook/admin/health route | Ownership, CSRF, RBAC, and KYC gates were generally strong. MFA attempt control, statement export, recipient preflight, paginated KYC review queues, policies, reconciliation, and maintenance were added. Verified KYC decisions now require an approved external evidence reference. External KYC collection and outbound bank rails remain intentionally absent. |
| Components/styles | Every component and global stylesheet | Responsive/mobile flows and empty/error states were coherent. Transfer now resolves and confirms the recipient name before posting; staff now have responsive, paginated evidence and decision interfaces instead of relying on raw API calls. |
| Core libraries | Every auth, crypto, DB, ledger, money, payment, webhook, mail, rate-limit, validator, HTTP, account, and activity module | Exact money and transaction locking were good. Critical races and retry/idempotency faults listed below were corrected. Key rotation, external screening, notifications, and provider-report ingestion remain open. |
| Public assets | Manifest icon and service worker | The service worker caches only public static/offline assets and never private APIs. It is a PWA, not a native mobile application; there is no device attestation, biometric credential, secure native storage, or push channel. |
| Tests | All original tests plus new unit/integration configuration | Baseline had 7 unit tests in 4 files. Current unit suite adds CSV-injection and controlled-decision coverage; PostgreSQL CI adds ledger, idempotency, concurrency, settlement, webhook, trigger, policy, MFA atomicity, and concurrent KYC-decision coverage. |
| Documentation | README, security, architecture, production gates, reference audit | Good honesty about not being a bank. Documentation is now aligned with implemented operations and explicitly separates code readiness from live/regulatory evidence. |

## Critical findings and implemented corrections

1. **Lost provider retries:** any duplicate callback returned success, including an earlier `FAILED` event. A transient first failure could therefore suppress every later settlement. Webhooks now have processing leases and attempt counts; failed/stale work is reclaimable, terminal work is exact-once, and event-ID/payload conflicts are audited.
2. **Unbound idempotency keys:** transfer/funding retries returned the old operation even when amount, accounts, method, currency, memo, or phone changed. Transfers now compare every persisted field; funding stores a canonical request hash. Concurrent intent creation is also handled.
3. **MFA replay and races:** a TOTP could be reused within its window and concurrent recovery-code requests could both pass. The accepted timestep and recovery-code consumption are now atomic, challenges have five attempts, old challenges are invalidated, and MFA login is rate-limited.
4. **Mutable/app-only ledger invariants:** positive values, balanced journals, financial identity, and ledger immutability were only application conventions. PostgreSQL now rejects non-positive/cross-currency-invalid rows, unbalanced posting, entry updates/deletes, and rewriting posted financial identity.
5. **Concurrent authentication counters:** failed-login counts used stale state and could overwrite a suspended status. The counter now locks the user row, updates atomically, caps safely, and preserves suspension. Existing sessions stop authenticating when the user is no longer active/verified.
6. **Settlement ambiguity and single-actor authority:** global provider-reference uniqueness conflated unrelated rails; bank settlement overwrote its instruction reference; late/expired captures could auto-credit; one finance identity could assert and settle evidence. References are provider-scoped, settlement evidence is separate, late evidence enters manual review, and manual credits now require an immutable encrypted review plus a different maker/checker identity.
7. **Unconfigured risk limits:** transfers had no amount/velocity boundary. An audited per-currency policy now enforces per-transfer plus rolling 24-hour amount/count limits inside the serializable transaction and fails closed when absent/disabled.
8. **Operational blind spots:** no cleanup/reconciliation endpoint, request correlation, recipient confirmation, statement export, or human staff control plane existed. Each is now implemented with appropriate authentication, pagination/bounds, audit behavior, and safe output handling.

## Current permissions and intent boundaries

| Actor | Permitted by code | Explicitly not permitted |
| --- | --- | --- |
| Anonymous | Register, verify e-mail, request/reset password, begin login, submit authenticated provider callbacks | Read accounts, move money, set roles/KYC/policies, settle funds |
| Customer | Read owned accounts/activity/statements/sessions; enroll MFA; request KYC review; fund and internally transfer after active/e-mail/KYC gates | Select ledger entries, settle provider evidence, inspect other users, assign roles, approve KYC, set limits |
| Support | Reserved role only | KYC decisions, policy changes, settlement |
| Compliance | Use the staff queue to record the result of an approved KYC process with required evidence for verification | Transaction policies and finance settlement |
| Finance admin | Use the staff console to propose/inspect/reject/approve manual settlement evidence (never approve own request), and run/read reconciliation/policies | Change transaction policies or assign roles |
| Platform admin | Compliance/finance console functions plus audited policy configuration | No public endpoint assigns privileged roles; provisioning must remain a reviewed external process |
| Scheduler | Run maintenance with a separate bearer secret | Customer/admin session actions |

## Scale and architecture limits

The current application is a coherent modular monolith and can scale horizontally for ordinary wallet traffic when all instances share PostgreSQL and secrets. Serializable row locking prevents double spend. High-volume launch still needs measured capacity work:

- provider calls and callbacks execute inline; use a durable outbox/queue and independently scalable workers before sustained provider volume;
- database rate-limit buckets and audit writes add primary-database load; define retention/partitioning and consider an approved distributed limiter at the edge;
- ledger, audit, webhook, and statement queries need production data-volume indexes/partition policy validated by `EXPLAIN` and load tests;
- introduce connection-budgeting, pooling/proxy policy, HA/failover tests, read replicas for safe read models, and SLO telemetry;
- add signed provider-report and sponsor-bank statement ingestion, automated matching, exception queues, and maker/checker workflows;
- define compensating-journal reversal, refund, chargeback, dispute, and dormant/frozen/closed-account workflows before those products are offered.

## Product, market, and niche assessment

What exists is best described as a **Kenya-first, closed-loop KES wallet platform**, not a full bank. Its clearest initial niches are sponsor-backed consumer wallets, SME/merchant ecosystems that pay within a closed network, platform disbursement wallets, and diaspora-funded local wallets through approved partners. M-Pesa familiarity plus internal instant transfers can be a strong acquisition wedge.

Those niches create obligations the UI alone does not reveal: safeguarding customer funds, cash-in settlement liquidity, agent/support escalation, SIM-swap/mobile fraud, mistaken-recipient recovery, dormant balances, beneficiary verification, transaction monitoring, and reliable provider/bank reconciliation. Cross-border remittance would add FX pricing, corridor licensing, source-of-funds, sanctions, payout, tax, and disclosure obligations. Savings/current account enums do not implement deposit products, interest, credit, cards, direct debit, bill pay, or deposit insurance and must not be marketed as if they do.

Expansion should be sequenced around a licensed operating model: (1) partner/KYC/AML and reconciliation, (2) closed-loop wallet launch with approved limits and support, (3) refunds/reversals/disputes and notifications, (4) merchant/SME APIs and bulk payouts, then only (5) regulated cross-border, savings, credit, or card products. Native mobile, USSD, multilingual access, biometric passkeys, and accessibility validation are meaningful distribution expansions but do not remove the regulatory dependencies.

## Unresolved production gates

The repository cannot, without external authority and evidence, complete or truthfully claim:

- a banking/payment/remittance license, sponsor-bank agreement, safeguarding structure, or deposit-insurance status;
- a selected/certified KYC vendor, document/biometric flow, sanctions/PEP screening, AML/CFT monitoring, SAR process, or case-management team;
- live Stripe/PayPal/Daraja/bank/e-mail credentials, production callback allowlists, provider certification, or real settlement-report formats;
- approved fees, limits, refund/chargeback/reversal/dispute terms, privacy notices, retention schedules, customer support, complaints, or vulnerable-customer procedures;
- production database/network/KMS, key rotation, HA, backups/PITR evidence, WAF/DDoS, monitoring/on-call, penetration testing, accessibility testing, load results, or disaster recovery;
- maker/checker controls beyond manual settlement, privileged identity governance, fraud decisioning, device intelligence, passkeys/risk-based step-up authentication, or legal/regulatory sign-off.

These are not placeholders to fill with guessed code. They are controlled decisions and third-party integrations listed in `PRODUCTION_GATES.md`. Until they are evidenced, BANK NOW must not accept real customers or real money and must not be described as regulatory-ready.

## Verification status

Locally verified in the audit environment: clean install, Prisma generation, strict TypeScript, zero-warning ESLint, 17 unit tests across nine files, production build, and an all-dependency audit with zero known vulnerabilities at the selected threshold. PostgreSQL and Docker binaries were unavailable locally.

The hardened pull request's quality job repeats install/generation/lint/type-check/unit/build/audit gates. Its database job deploys every migration to a disposable PostgreSQL 17 service, checks Prisma schema drift, and runs nine database integration scenarios, including financial/KYC concurrency and trigger enforcement. A green run is migration/integration evidence for the reviewed commit in CI; it does not mean an undisclosed production database was migrated and does not satisfy any regulatory or partner gate.
