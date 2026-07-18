import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { minorToDecimal } from "@/lib/money";

const MAX_STATEMENT_ROWS = 5_000;

export function csvCell(value: string): string {
  const formulaSafe = /^[=+\-@]/.test(value) ? "'" + value : value;
  return '"' + formulaSafe.replaceAll('"', '""') + '"';
}

export async function generateAccountStatement(input: {
  userId: string;
  accountId: string;
  from: Date;
  toExclusive: Date;
}): Promise<{ csv: string; accountNumber: string; rowCount: number }> {
  const account = await getDb().account.findFirst({
    where: {
      id: input.accountId,
      userId: input.userId,
      isSystem: false,
    },
  });
  if (!account) {
    throw new AppError("ACCOUNT_NOT_FOUND", "The selected account could not be found.", 404);
  }
  const entries = await getDb().ledgerEntry.findMany({
    where: {
      accountId: account.id,
      createdAt: { gte: input.from, lt: input.toExclusive },
      journal: { status: "POSTED" },
    },
    include: {
      journal: {
        select: { reference: true, narration: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_STATEMENT_ROWS + 1,
  });
  if (entries.length > MAX_STATEMENT_ROWS) {
    throw new AppError(
      "STATEMENT_RANGE_TOO_LARGE",
      "This statement contains too many rows. Choose a shorter date range.",
      413,
    );
  }

  const rows = [
    [
      "Timestamp (UTC)",
      "Reference",
      "Description",
      "Direction",
      "Amount",
      "Currency",
      "Balance after",
      "Account number",
    ],
    ...entries.map((entry) => [
      entry.createdAt.toISOString(),
      entry.journal.reference,
      entry.journal.narration,
      entry.direction,
      minorToDecimal(entry.amountMinor, entry.currency),
      entry.currency,
      entry.balanceAfterMinor === null
        ? ""
        : minorToDecimal(entry.balanceAfterMinor, entry.currency),
      account.accountNumber,
    ]),
  ];

  return {
    csv: "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n",
    accountNumber: account.accountNumber,
    rowCount: entries.length,
  };
}
