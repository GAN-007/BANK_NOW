import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

type JournalDiscrepancyRow = {
  id: string;
  reference: string;
  currency: string;
  entryCount: number;
  debitTotalMinor: string;
  creditTotalMinor: string;
  currencyMismatchCount: number;
};

type AccountDiscrepancyRow = {
  id: string;
  accountNumber: string;
  currency: string;
  isSystem: boolean;
  ledgerClass: string;
  storedBalanceMinor: string;
  calculatedBalanceMinor: string;
};

export async function runLedgerReconciliation() {
  const [journalRows, accountRows] = await Promise.all([
    getDb().$queryRaw<JournalDiscrepancyRow[]>(Prisma.sql`
      SELECT
        j."id",
        j."reference",
        j."currency",
        COUNT(e."id")::integer AS "entryCount",
        COALESCE(SUM(e."amountMinor") FILTER (WHERE e."direction" = 'DEBIT'), 0)::text AS "debitTotalMinor",
        COALESCE(SUM(e."amountMinor") FILTER (WHERE e."direction" = 'CREDIT'), 0)::text AS "creditTotalMinor",
        COUNT(e."id") FILTER (WHERE e."currency" <> j."currency")::integer AS "currencyMismatchCount"
      FROM "Journal" j
      LEFT JOIN "LedgerEntry" e ON e."journalId" = j."id"
      WHERE j."status" = 'POSTED'
      GROUP BY j."id", j."reference", j."currency"
      HAVING
        COUNT(e."id") < 2 OR
        COALESCE(SUM(e."amountMinor") FILTER (WHERE e."direction" = 'DEBIT'), 0) <>
          COALESCE(SUM(e."amountMinor") FILTER (WHERE e."direction" = 'CREDIT'), 0) OR
        COUNT(e."id") FILTER (WHERE e."currency" <> j."currency") > 0
      ORDER BY j."createdAt" ASC
      LIMIT 1001
    `),
    getDb().$queryRaw<AccountDiscrepancyRow[]>(Prisma.sql`
      WITH posted_totals AS (
        SELECT
          e."accountId",
          COALESCE(SUM(e."amountMinor") FILTER (WHERE e."direction" = 'DEBIT'), 0) AS debits,
          COALESCE(SUM(e."amountMinor") FILTER (WHERE e."direction" = 'CREDIT'), 0) AS credits
        FROM "LedgerEntry" e
        INNER JOIN "Journal" j ON j."id" = e."journalId" AND j."status" = 'POSTED'
        GROUP BY e."accountId"
      )
      SELECT
        a."id",
        a."accountNumber",
        a."currency",
        a."isSystem",
        a."ledgerClass"::text AS "ledgerClass",
        a."ledgerBalanceMinor"::text AS "storedBalanceMinor",
        CASE
          WHEN a."ledgerClass" IN ('ASSET', 'EXPENSE')
            THEN (COALESCE(t.debits, 0) - COALESCE(t.credits, 0))::text
          ELSE (COALESCE(t.credits, 0) - COALESCE(t.debits, 0))::text
        END AS "calculatedBalanceMinor"
      FROM "Account" a
      LEFT JOIN posted_totals t ON t."accountId" = a."id"
      WHERE a."ledgerBalanceMinor" <>
        CASE
          WHEN a."ledgerClass" IN ('ASSET', 'EXPENSE')
            THEN COALESCE(t.debits, 0) - COALESCE(t.credits, 0)
          ELSE COALESCE(t.credits, 0) - COALESCE(t.debits, 0)
        END
      ORDER BY a."createdAt" ASC
      LIMIT 1001
    `),
  ]);

  const truncated = journalRows.length > 1000 || accountRows.length > 1000;
  const journalDiscrepancies = journalRows.slice(0, 1000);
  const accountDiscrepancies = accountRows.slice(0, 1000);
  return {
    healthy:
      journalDiscrepancies.length === 0 && accountDiscrepancies.length === 0,
    checkedAt: new Date().toISOString(),
    truncated,
    journalDiscrepancies,
    accountDiscrepancies,
  };
}
