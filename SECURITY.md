# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, exposed credential, payment discrepancy, or customer-data concern. Contact the BANK NOW security owner through the organization’s private security channel and include reproduction steps, impact, affected commit, and any evidence that must be preserved.

If a credential is found in source control, treat it as compromised: revoke it at the provider, rotate dependent secrets, review access logs, and remove it from history according to the organization’s incident process. Removing a file alone is not sufficient.

## Security expectations

- Keep `.env` files, provider keys, signing material, TLS private keys, customer data, webhook payloads, and database dumps out of Git.
- Use a managed secret store and distinct keys for development, staging, and production.
- Apply Prisma migrations through a reviewed deployment job, not automatically from a browser-facing process.
- Keep provider callbacks authenticated according to the provider (signed Stripe/PayPal events; protected M-Pesa callback endpoint), replay-protected, and externally monitored.
- Restrict finance and compliance roles with least privilege and review their audit trail.
- Complete dependency updates and security scans before releases.

The application stores opaque session-token hashes, encrypted confidential provider references/payloads, and integer money values. These controls reduce risk; they do not replace a formal threat model, penetration test, regulatory review, or incident-response program.
