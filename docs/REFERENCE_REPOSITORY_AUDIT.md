# Reference repository assessment

## Scope reviewed

The public `adrianhajdin/banking` repository was inventoried end-to-end before this rebuild: both repository branches (`main` and `fix/safari-auth-cookie`), its 107 tracked files per branch, route tree, components, action modules, Appwrite/Plaid/Dwolla integrations, configuration, type definitions, public assets, commits, issues, pull requests, and deployment status.

`main` and `fix/safari-auth-cookie` differ only in the Appwrite session cookie `sameSite` setting, which changes from `strict` to `none`. That workaround widens cross-site cookie behavior without adding an equivalent CSRF/origin defense, so it was not carried forward. The repository has no tracked CI workflow, test suite, migration directory, Docker configuration, issues, or pull requests. Its latest observed Vercel deployment status was failed.

## Reference architecture

The reference is a Next.js 14 tutorial application branded “Horizon.” It uses Appwrite for authentication/data storage, Plaid for financial-account linking and transaction ingestion, and Dwolla for recipient/transfer creation. Its file tree comprises:

| Area | Reviewed content |
| --- | --- |
| App routes | Home, sign-in/up, dashboard, transactions, payment-transfer, and error/Sentry example routes. |
| Components | Dashboard, account, transfer, sidebar/header/mobile nav, pagination, charts, forms, and shadcn UI primitives. |
| Server actions | User/Appwrite session actions plus Plaid, bank, Dwolla, and transaction actions. |
| Configuration | Next, TypeScript, Tailwind, Sentry, Appwrite/Plaid utility modules, environment example, and project metadata. |
| Assets | The complete `public/` icon/illustration set was inspected; no executable SVG scripting was identified. |

## Key findings

The reference is useful as a dashboard tutorial, but its current implementation is not suitable as a production banking system:

1. It commits/previously committed environment material and contains hard-coded sandbox-style Appwrite/Plaid configuration values. Any such values should be treated as exposed and rotated.
2. Build configuration suppresses TypeScript and ESLint failures, while the project has no automated tests, CI, migrations-as-code, container configuration, or deployment checks.
3. PII such as date of birth and SSN is placed directly in application documents without a demonstrated minimization, encryption, retention, or recovery model.
4. The “encryption” helper is base64 encoding. It can expose account IDs and contributes to insecure direct-object-reference risk.
5. Server actions accept account and recipient identifiers without consistently proving ownership/authorization for every money-moving operation.
6. Transfer creation validates amounts weakly, does not enforce a true ledger/balance model, uses non-atomic provider/application writes, and lacks idempotent settlement, refund/reversal, reconciliation, webhook state, limits, fraud, or AML controls.
7. Plaid transaction synchronization does not advance/use its cursor correctly and can overwrite/repeat history. Provider access tokens are stored without a demonstrated encryption/key-management layer.
8. Session handling lacks MFA, lifecycle/device controls, robust rate limiting, password recovery, and a safe Safari strategy. The alternate branch weakens `SameSite` rather than adding explicit protection.
9. The Sentry setup uses a hard-coded DSN, a deliberate error endpoint, and broad trace/replay settings without a privacy/telemetry boundary.
10. The UI includes small quality issues (typos, invalid class/SVG attributes, account-data logging, fragile keys, and incomplete empty/error states), and the app forces dynamic rendering globally.

## Rebuild decisions

BANK NOW is a clean implementation, not a code or asset copy. It retains the product intent—account overview, transaction history, payments, and transfer workflows—while replacing the tutorial architecture with:

- PostgreSQL schema and reviewed migration with a double-entry journal/ledger;
- wallet ownership checks, idempotency, serializable locking, and integer minor-unit amounts;
- encrypted sensitive provider data, opaque session tokens, Argon2id, TOTP MFA, reset/verification flows, CSRF/origin checks, rate limits, RBAC, and audit logs;
- M-Pesa callback-secret validation plus signed Stripe/PayPal webhook flows and role-gated bank reconciliation;
- responsive PWA delivery, health checks, Docker, tests, lint/type/build gates, Dependabot, CI, and production-readiness documentation.

The reference project’s MIT license permits reuse subject to its terms; no reference source or artwork is included here. This assessment is architectural and security-oriented, and it does not substitute for legal or regulatory advice.
