import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

import { formatMinorAmount } from "@/lib/money";

export type ActivityRow = {
  id: string;
  accountName: string;
  accountNumber: string;
  direction: "CREDIT" | "DEBIT";
  amountMinor: string;
  currency: string;
  narration: string;
  status: string;
  reference: string;
  createdAt: string;
};

export function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <p>No posted activity yet.</p>
        <span>Funding and transfers will appear here once confirmed.</span>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className="activity-table">
        <thead>
          <tr>
            <th>Activity</th>
            <th>Account</th>
            <th>Reference</th>
            <th>When</th>
            <th className="align-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isCredit = row.direction === "CREDIT";
            return (
              <tr key={row.id}>
                <td>
                  <div className="activity-title">
                    <span className={isCredit ? "activity-icon incoming" : "activity-icon outgoing"}>
                      {isCredit ? (
                        <ArrowDownLeft aria-hidden="true" size={18} />
                      ) : (
                        <ArrowUpRight aria-hidden="true" size={18} />
                      )}
                    </span>
                    <span>
                      <strong>{row.narration}</strong>
                      <small>{row.status.toLowerCase()}</small>
                    </span>
                  </div>
                </td>
                <td>{row.accountName}</td>
                <td><code>{row.reference}</code></td>
                <td>{new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.createdAt))}</td>
                <td className={isCredit ? "amount positive align-right" : "amount negative align-right"}>
                  {isCredit ? "+" : "-"}
                  {formatMinorAmount(BigInt(row.amountMinor), row.currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
