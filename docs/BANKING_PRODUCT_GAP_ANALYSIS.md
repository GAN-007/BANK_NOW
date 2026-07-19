# BANK NOW banking product and accounting gap analysis

## Scope and architectural decision

This review complements `REPOSITORY_AUDIT.md` and evaluates the hardened branch as a banking product. BANK NOW is currently a secure wallet, funding-orchestration and internal-transfer foundation. It is not a licensed bank or a sponsor-bank replacement.

The supplied TypeORM design is a requirements reference, not code to paste into this Prisma application. BANK NOW already represents money as integer ISO-currency minor units (`BigInt`/`BIGINT`), preventing IEEE-754 corruption without introducing a second ORM. Any future currency exponent must come from a versioned currency registry; money must never be represented as JavaScript `number`.

## Implemented foundation

| Capability | Current evidence |
| --- | --- |
| Precision and double entry | Minor-unit integers; pending journals; balanced debit/credit posting enforced by PostgreSQL triggers |
| Concurrency and idempotency | Serializable transactions, ordered locks, bounded deadlock retries, payload-bound idempotency |
| Ledger integrity | Append-only entries, immutable financial identity, cached-balance reconciliation |
| Clearing and settlement | Per-currency clearing accounts, provider evidence, leased webhook processing, maker-checker manual settlement |
| Security and operations | Argon2, sessions/CSRF, MFA anti-replay, RBAC, KYC review, limits, audit logs, reconciliation and maintenance |
| Delivery | Non-root image; pinned CI; migration, drift, PostgreSQL integration, build and dependency gates |

## Required accounting and monetary-flow work

P0 is required for a controlled test-money showcase; P1 is required before a supervised pilot; P2 is portfolio expansion.

| Priority | Gap | Required invariant |
| --- | --- | --- |
| P0 | Chart of accounts | Versioned GL codes, normal balances, product/branch/cost-centre dimensions and controlling-account reconciliation. Changes require maker-checker approval. |
| P0 | Holds and liens | Authorization, expiry, partial capture and release. Hold reduces available balance only; capture posts once; release cannot create funds. |
| P0 | Compensating reversals | One immutable reversal link per posted journal. Swap every entry exactly once and atomically update cached balances; never edit original entries. |
| P0 | External-payment state machine | Separate instruction lifecycle: received, screening, authorized, held, submitted, accepted, settled, rejected, returned or cancelled. Provider acceptance is not settlement. |
| P0 | Transactional outbox/inbox | Commit messages with business state; leased workers, payload deduplication, bounded retry and dead letters. No provider call inside a ledger transaction. |
| P0 | End-of-day controls | Trial balance, customer-control reconciliation, suspense aging, unmatched statement items, abnormal balances and dual-controlled close/reopen evidence. |
| P0 | Beneficiary safety | Verified identity/rail details, name enquiry, cooling period, step-up MFA, limits, allow/block state and enumeration-resistant confirmation. |
| P0 | Fees and taxes | Effective-dated tariffs, pre-authorization quote, revenue/payable postings, reversals and dual-controlled waivers. No hard-coded tax or fee rates. |
| P1 | Interest and accruals | Contract/rate versions, day-count rules, value dates, replay-safe daily accrual, capitalization and approved withholding treatment. |
| P1 | FX | Currency exponents, expiring quotes, spread, rounding GL, exposure limits, position/P&L and balanced two-currency postings. |
| P1 | Lending | Decision evidence, consent, schedules, principal/interest/fee GLs, arrears, restructure, collection, impairment and bureau adapters. |
| P1 | Disputes/returns | Cases, evidence, deadlines, provisional credit, return/chargeback codes, recovery and write-off approval. |
| P1 | Reconciliation | Signed external statements, source lineage, deterministic matching, exceptions, aging, adjustments under dual control and proof of settlement. |
| P1 | Period accounting | Period locks, adjusting entries, close, trial balance, balance sheet, income statement, audit export and legal hold. |
| P2 | Cards, cash and agents | Certified processors/schemes, PCI/HSM controls, card clearing/disputes; till/vault/agent-float accounting and physical controls. |
| P2 | Trade, treasury and wealth | Separate regulated domains; these must not be simulated in the retail wallet ledger. |

## Kenyan and international capability map

Equity, KCB, I&M and Co-operative Bank product families span current/savings/salary/youth/diaspora/business accounts, mobile/internet banking, cards, bills and airtime, mobile money/interbank transfers, loans and mortgages, agency/merchant services, investments, insurance, trade and cash management. A Chase-scale portfolio additionally includes ACH/wires, cards, merchant acquiring, credit, investments and corporate treasury. Matching that breadth is a multi-year regulated portfolio, not an MVP criterion.

| Rail/domain | Minimum real implementation | Status |
| --- | --- | --- |
| M-Pesa | Contracted Daraja access; C2B validation/confirmation; B2C result/timeout; key lifecycle; till/paybill reconciliation and reversals | Adapter foundation only |
| PesaLink | Sponsor/member access, official directory, name enquiry, scheme limits, signed ISO 20022 messages, returns and settlement reconciliation | Absent |
| EFT/ACH | Cut-offs/holidays, batches and control totals, value dates, signed/encrypted files, returns and settlement reports | Absent |
| KEPSS/RTGS | Direct/sponsor access, liquidity and queue control, maker-checker, ISO 20022 and CBK settlement evidence | Absent |
| SWIFT | Parties/BICs, sanctions, fee option, FX, correspondent route, UETR/status, investigations and nostro reconciliation | Absent |
| Cards | Certified issuer/processor, tokenization/HSM, authorization holds, clearing, refunds and disputes | Absent |
| Billers/merchants | Contracted catalogue, reference validation, quote, settlement/commission reconciliation and refunds | Absent |

No AML, reporting, fee or tax threshold should be copied from prose into code. Current counsel-approved policy and certified providers must supply effective-dated rules, approvals and evidence.

## Users, permissions and niches

The role enum is too broad for a bank. Add scoped permissions by legal entity, organization, branch, currency, product, portfolio and amount. Separate customer delegate, support read-only, fraud, AML, KYC, payment operations, reconciliation, finance poster/approver, security administration, auditor and SRE duties. Privileged access needs phishing-resistant MFA, just-in-time elevation, approval, immutable evidence and periodic certification. No actor may request and approve the same action.

Business banking needs organizations, beneficial owners, directors/signatories, mandates, signing groups, bulk payments, payroll confidentiality and per-user/account limits.

The strongest initial niche is a sponsor-bank-backed Kenya-first money-operations product for individuals and SMEs: M-Pesa plus bank transfers, beneficiary safety, transparent fees, statements and excellent reconciliation. Chama/SACCO controlled payments are a strong second niche through multi-signature mandates, collections and member sub-ledgers. Diaspora disbursement adds attractive demand but also FX, sanctions, safeguarding and cross-border licensing complexity.

## Showcase acceptance criteria

Use only synthetic identities and test money, label the environment, and demonstrate identity/MFA/session controls; account restrictions; exactly-once sandbox funding; beneficiary confirmation and step-up transfer; holds/capture/release and controlled reversal when implemented; statements tied to journals; maker-checker operations; discrepancy detection; fail-closed dependencies; and CI evidence for migrations, constraints, concurrency, security, accessibility and load envelopes.

## Mandatory production gates

Legal entity and permissions; CBK and other applicable approvals; sponsor/settlement-bank and scheme contracts; safeguarding design; approved terms/pricing/complaints; certified KYC/KYB, AML, PEP, sanctions and fraud services; data-protection assessment; external finance/settlement reconciliation; PCI scope where applicable; independent penetration, resilience, accessibility and load testing; production KMS/HSM/SIEM/backups/DR; staffed support, disputes, treasury, compliance and finance operations; and independent accounting, security and legal sign-off remain mandatory.

Until evidenced, describe BANK NOW as a hardened banking-app prototype—not production-ready banking infrastructure or a regulated bank.
