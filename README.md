# BANK NOW

BANK NOW is a mobile-first banking progressive web app (PWA) for KES wallets. It combines a responsive Next.js application with a PostgreSQL-backed double-entry ledger, secure customer sessions, MFA, role-gated operations, and provider-facing funding flows for M-Pesa, bank transfer, Visa/Mastercard through Stripe, and PayPal.

It is an engineering foundation, **not a licensed bank or a production payment service by itself**. Before real customers or money are introduced, the production gates in [docs/PRODUCTION_GATES.md](docs/PRODUCTION_GATES.md) must be completed with regulated partners and legal/compliance approval.

## What is included

| Area | Implementation |
| --- | --- |
| Customer access | Argon2id password hashing, e-mail verification, HTTP-only opaque sessions, CSRF and same-origin validation, login lockout, password reset, session revocation, and TOTP MFA with recovery codes. |
| Accounts and money | KES customer wallets, ownership checks, integer minor units, Luhn-style account numbers, immutable journals, balanced ledger entries, idempotent transfers, and serializable account locking. |
| Funding | M-Pesa STK Push, bank-transfer instruction and finance reconciliation, Stripe Checkout, and PayPal Orders/capture. A balance is credited only from a verified callback or authorized finance settlement. |
| Controls | RBAC for customer, support, compliance, finance, and platform administration; encrypted provider payloads/references; audit events; provider-webhook deduplication; request rate limits; CSP and browser security headers. |
| Mobile delivery | Responsive interface, web app manifest, installable icon, service worker, and an offline shell that never caches private API data. |
| Operations | Prisma schema/migration, Docker image, local PostgreSQL compose file, test/lint/type/build scripts, Dependabot, and GitHub Actions CI. |

Architecture and data-flow details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The source-repository assessment that informed this rebuild is in [docs/REFERENCE_REPOSITORY_AUDIT.md](docs/REFERENCE_REPOSITORY_AUDIT.md).

## Run locally

Requirements: Node 24+, npm 11+, and PostgreSQL 17+ (or Docker).

```bash
cp .env.example .env
docker compose up -d postgres
npm ci
npm run prisma:generate
npm run prisma:deploy
SEED_DEMO_DATA=true npm run prisma:seed
npm run dev
```

The optional seed creates a local `PLATFORM_ADMIN` only. Set a unique `SEED_ADMIN_PASSWORD`; never enable seed data in a deployed environment.

Open `http://localhost:3000`. In development, verification and password-reset responses include a local-only link when e-mail credentials are absent. That behavior is disabled in production.

## Configure secrets and providers

Copy `.env.example` and set unique values for `SESSION_PEPPER` and `FIELD_ENCRYPTION_KEY` (a base64-encoded 32-byte key). Store production values in a managed secret store, never in GitHub, build logs, browser-exposed variables, or the database.

Configure each provider only after its production contract, callback URLs, and webhook validation are approved:

- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `POST /api/webhooks/stripe`.
- PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, and `POST /api/webhooks/paypal`.
- Safaricom Daraja: M-Pesa credentials, a public HTTPS callback URL, and `MPESA_CALLBACK_SECRET` used by `POST /api/webhooks/mpesa`.
- Bank transfer: verified partner account instructions and finance users who may call `POST /api/admin/payment-intents/:id/settle`.
- E-mail: `RESEND_API_KEY` and a verified `EMAIL_FROM` domain.

Provider callbacks are deliberately the settlement authority. A return page, browser redirect, or a provider reference alone cannot increase a wallet balance.

## Useful commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run prisma:deploy
```

Use `npm run check` for lint, type checking, and unit tests together. The application health endpoint is `GET /api/health`; it reports ready only when PostgreSQL is reachable.

## Deploy

1. Provision PostgreSQL with encrypted backups, restricted network access, and a separate application database user.
2. Set all runtime secrets in your deployment platform and configure the canonical public URL.
3. Run `npm ci`, `npm run prisma:generate`, `npm run check`, then `npm run prisma:deploy` as a controlled migration step.
4. Build with `docker build -t bank-now .` or your platform equivalent, deploy behind TLS, and confirm `/api/health`.
5. Register the exact production callback URLs with Stripe, PayPal, Safaricom, and the bank partner. Validate signed Stripe/PayPal events and the M-Pesa callback-secret/status flow before enabling a payment method.
6. Complete the gates in [docs/PRODUCTION_GATES.md](docs/PRODUCTION_GATES.md).

## Security

See [SECURITY.md](SECURITY.md) for reporting and secret-handling guidance. Do not use real customer data in local development, seed data, or test fixtures.
