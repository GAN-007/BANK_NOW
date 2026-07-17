import { Landmark } from "lucide-react";

import { formatMinorAmount } from "@/lib/money";

export type AccountCardData = {
  id: string;
  accountNumber: string;
  displayName: string;
  currency: string;
  kind: string;
  status: string;
  availableBalanceMinor: string;
  ledgerBalanceMinor: string;
};

export function AccountCard({ account }: { account: AccountCardData }) {
  return (
    <article className="account-card">
      <div className="account-card__head">
        <span className="icon-disc">
          <Landmark aria-hidden="true" size={20} />
        </span>
        <span className="status-pill">{account.status.toLowerCase()}</span>
      </div>
      <p className="eyebrow">{account.kind.toLowerCase()} account</p>
      <h3>{account.displayName}</h3>
      <p className="account-balance">
        {formatMinorAmount(BigInt(account.availableBalanceMinor), account.currency)}
      </p>
      <div className="account-card__footer">
        <span>Account</span>
        <strong>{account.accountNumber}</strong>
      </div>
    </article>
  );
}
