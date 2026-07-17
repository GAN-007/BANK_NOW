import type {
  PaymentIntentStatus,
  PaymentMethod,
  Provider,
} from "@/generated/prisma/client";

export type FundingInstruction =
  | {
      kind: "mpesa";
      paymentIntentId: string;
      status: PaymentIntentStatus;
      checkoutRequestId: string;
      customerMessage: string;
    }
  | {
      kind: "redirect";
      paymentIntentId: string;
      status: PaymentIntentStatus;
      provider: Provider;
      checkoutUrl: string;
    }
  | {
      kind: "bank_transfer";
      paymentIntentId: string;
      status: PaymentIntentStatus;
      reference: string;
      bankName: string;
      accountName: string;
      accountNumber: string;
      branch?: string;
    };

export type NewFundingRequest = {
  accountId: string;
  amount: string;
  currency: string;
  method: PaymentMethod;
  idempotencyKey: string;
  phoneNumber?: string;
};
