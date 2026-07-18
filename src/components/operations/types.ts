import { formatMinorAmount } from "@/lib/money";

export type StaffRole =
  | "COMPLIANCE"
  | "FINANCE_ADMIN"
  | "PLATFORM_ADMIN";

export type SettlementStatus =
  | "REQUESTED"
  | "APPROVED"
  | "EXECUTED"
  | "REJECTED";

export type SettlementReview = {
  id: string;
  paymentIntentId: string;
  settlementReference: string;
  evidenceHash: string;
  reason: string;
  status: SettlementStatus;
  requestedById: string;
  approvedById: string | null;
  rejectedById: string | null;
  rejectionReason: string | null;
  requestedAt: string;
  approvedAt: string | null;
  executedAt: string | null;
  rejectedAt: string | null;
  paymentIntent: {
    provider: string;
    method: string;
    status: string;
    amountMinor: string;
    currency: string;
    userId: string;
    providerReference?: string | null;
  };
};

export type SettlementReviewDetail = SettlementReview & {
  evidenceReference: string;
};

export type Policy = {
  currency: string;
  enabled: boolean;
  maximumAmountMinor: string;
  rolling24HourAmountLimitMinor: string;
  rolling24HourCountLimit: number;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Reconciliation = {
  healthy: boolean;
  checkedAt: string;
  truncated: boolean;
  journalDiscrepancies: Array<{
    id: string;
    reference: string;
    currency: string;
    entryCount: number;
    debitTotalMinor: string;
    creditTotalMinor: string;
    currencyMismatchCount: number;
  }>;
  accountDiscrepancies: Array<{
    id: string;
    accountNumber: string;
    currency: string;
    isSystem: boolean;
    ledgerClass: string;
    storedBalanceMinor: string;
    calculatedBalanceMinor: string;
  }>;
};

export type KycReview = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  kycStatus: "PENDING" | "MANUAL_REVIEW";
  createdAt: string;
  updatedAt: string;
  kycProfile: {
    provider: string | null;
    submittedAt: string | null;
    updatedAt: string;
  } | null;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export function displayStatus(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}

export function displayDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("en-KE", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not recorded";
}

export function displayAmount(
  amountMinor: string,
  currency: string,
): string {
  return formatMinorAmount(BigInt(amountMinor), currency);
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
