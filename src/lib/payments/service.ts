import {
  PaymentIntentStatus,
  PaymentMethod,
  Provider,
} from "@/generated/prisma/client";
import { getOwnedActiveAccount } from "@/lib/accounts";
import { getDb } from "@/lib/db";
import { AppError, isAppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { parseMinorAmount, serializeMinor } from "@/lib/money";
import { initiateMpesaStkPush } from "@/lib/payments/mpesa";
import { createPayPalOrder } from "@/lib/payments/paypal";
import { createStripeCheckout } from "@/lib/payments/stripe";
import {
  type FundingInstruction,
  type NewFundingRequest,
} from "@/lib/payments/types";

function providerFor(method: PaymentMethod): Provider {
  switch (method) {
    case PaymentMethod.MPESA:
      return Provider.MPESA;
    case PaymentMethod.CARD:
      return Provider.STRIPE;
    case PaymentMethod.PAYPAL:
      return Provider.PAYPAL;
    case PaymentMethod.BANK_TRANSFER:
      return Provider.BANK_TRANSFER;
  }
}

function bankTransferInstruction(input: {
  paymentIntentId: string;
  status: PaymentIntentStatus;
}): Extract<FundingInstruction, { kind: "bank_transfer" }> {
  const environment = getEnv();
  if (
    !environment.BANK_TRANSFER_BANK_NAME ||
    !environment.BANK_TRANSFER_ACCOUNT_NAME ||
    !environment.BANK_TRANSFER_ACCOUNT_NUMBER
  ) {
    throw new AppError(
      "BANK_TRANSFER_UNAVAILABLE",
      "Bank-transfer instructions are not configured yet.",
      503,
    );
  }

  return {
    kind: "bank_transfer",
    paymentIntentId: input.paymentIntentId,
    status: input.status,
    reference: "BNK-" + input.paymentIntentId.slice(-12).toUpperCase(),
    bankName: environment.BANK_TRANSFER_BANK_NAME,
    accountName: environment.BANK_TRANSFER_ACCOUNT_NAME,
    accountNumber: environment.BANK_TRANSFER_ACCOUNT_NUMBER,
    branch: environment.BANK_TRANSFER_BRANCH,
  };
}

function existingInstruction(intent: {
  id: string;
  method: PaymentMethod;
  provider: Provider;
  status: PaymentIntentStatus;
  providerReference: string | null;
  checkoutUrl: string | null;
}): FundingInstruction {
  if (intent.method === PaymentMethod.BANK_TRANSFER) {
    return bankTransferInstruction({
      paymentIntentId: intent.id,
      status: intent.status,
    });
  }

  if (intent.method === PaymentMethod.MPESA && intent.providerReference) {
    return {
      kind: "mpesa",
      paymentIntentId: intent.id,
      status: intent.status,
      checkoutRequestId: intent.providerReference,
      customerMessage: "Check your phone and approve the pending M-Pesa request.",
    };
  }

  if (intent.checkoutUrl) {
    return {
      kind: "redirect",
      paymentIntentId: intent.id,
      status: intent.status,
      provider: intent.provider,
      checkoutUrl: intent.checkoutUrl,
    };
  }

  throw new AppError(
    "PAYMENT_REQUIRES_REVIEW",
    "This payment could not be resumed automatically. Contact support.",
    409,
  );
}

export async function createFundingIntent(
  user: { id: string; email: string },
  request: NewFundingRequest,
): Promise<FundingInstruction> {
  const account = await getOwnedActiveAccount({
    userId: user.id,
    accountId: request.accountId,
    currency: request.currency,
  });
  const amountMinor = parseMinorAmount(request.amount, account.currency);
  const existing = await getDb().paymentIntent.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: user.id,
        idempotencyKey: request.idempotencyKey,
      },
    },
  });

  if (existing) {
    return existingInstruction(existing);
  }

  const intent = await getDb().paymentIntent.create({
    data: {
      userId: user.id,
      accountId: account.id,
      provider: providerFor(request.method),
      method: request.method,
      idempotencyKey: request.idempotencyKey,
      amountMinor,
      currency: account.currency,
      status: PaymentIntentStatus.CREATED,
      expiresAt: new Date(Date.now() + 1000 * 60 * 30),
    },
  });

  try {
    if (request.method === PaymentMethod.MPESA) {
      if (!request.phoneNumber) {
        throw new AppError("MPESA_PHONE_REQUIRED", "Enter the phone number to receive the M-Pesa prompt.", 422);
      }
      const response = await initiateMpesaStkPush({
        paymentIntentId: intent.id,
        amountMinor,
        currency: account.currency,
        phoneNumber: request.phoneNumber,
      });
      await getDb().paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentIntentStatus.PENDING,
          providerReference: response.checkoutRequestId,
        },
      });
      return {
        kind: "mpesa",
        paymentIntentId: intent.id,
        status: PaymentIntentStatus.PENDING,
        checkoutRequestId: response.checkoutRequestId,
        customerMessage: response.customerMessage,
      };
    }

    if (request.method === PaymentMethod.CARD) {
      const response = await createStripeCheckout({
        paymentIntentId: intent.id,
        amountMinor,
        currency: account.currency,
        customerEmail: user.email,
      });
      await getDb().paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentIntentStatus.REQUIRES_ACTION,
          providerReference: response.sessionId,
          checkoutUrl: response.checkoutUrl,
        },
      });
      return {
        kind: "redirect",
        paymentIntentId: intent.id,
        status: PaymentIntentStatus.REQUIRES_ACTION,
        provider: Provider.STRIPE,
        checkoutUrl: response.checkoutUrl,
      };
    }

    if (request.method === PaymentMethod.PAYPAL) {
      const response = await createPayPalOrder({
        paymentIntentId: intent.id,
        amountMinor,
        currency: account.currency,
      });
      await getDb().paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentIntentStatus.REQUIRES_ACTION,
          providerReference: response.orderId,
          checkoutUrl: response.approvalUrl,
        },
      });
      return {
        kind: "redirect",
        paymentIntentId: intent.id,
        status: PaymentIntentStatus.REQUIRES_ACTION,
        provider: Provider.PAYPAL,
        checkoutUrl: response.approvalUrl,
      };
    }

    const instruction = bankTransferInstruction({
      paymentIntentId: intent.id,
      status: PaymentIntentStatus.PENDING,
    });
    await getDb().paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: PaymentIntentStatus.PENDING,
        providerReference: instruction.reference,
      },
    });
    return instruction;
  } catch (error) {
    await getDb().paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: PaymentIntentStatus.FAILED,
        failureCode: isAppError(error) ? error.code : "PROVIDER_ERROR",
      },
    });
    throw error;
  }
}

export async function findPaymentIntentByProviderReference(input: {
  provider: Provider;
  providerReference: string;
}) {
  return getDb().paymentIntent.findFirst({
    where: {
      provider: input.provider,
      providerReference: input.providerReference,
    },
  });
}

export async function markFundingIntentFailed(input: {
  provider: Provider;
  providerReference: string;
  failureCode: string;
}): Promise<void> {
  await getDb().paymentIntent.updateMany({
    where: {
      provider: input.provider,
      providerReference: input.providerReference,
      status: {
        not: PaymentIntentStatus.SUCCEEDED,
      },
    },
    data: {
      status: PaymentIntentStatus.FAILED,
      failureCode: input.failureCode.slice(0, 128),
    },
  });
}

export async function listFundingIntents(userId: string) {
  const intents = await getDb().paymentIntent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return intents.map((intent) => ({
    id: intent.id,
    method: intent.method,
    provider: intent.provider,
    status: intent.status,
    currency: intent.currency,
    amountMinor: serializeMinor(intent.amountMinor),
    createdAt: intent.createdAt.toISOString(),
    completedAt: intent.completedAt?.toISOString() ?? null,
    failureCode: intent.failureCode,
  }));
}
