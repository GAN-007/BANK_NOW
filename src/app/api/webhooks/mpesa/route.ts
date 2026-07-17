import { type NextRequest } from "next/server";

import { Provider } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { settleFundingIntent } from "@/lib/domain/ledger";
import { AppError } from "@/lib/errors";
import { failure, success } from "@/lib/http";
import {
  markFundingIntentFailed,
} from "@/lib/payments/service";
import { verifyMpesaCallbackToken } from "@/lib/payments/mpesa";
import { beginWebhook, completeWebhook, rejectWebhook } from "@/lib/webhooks/store";

type MpesaCallback = {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResultCode?: number;
      ResultDesc?: string;
      CallbackMetadata?: {
        Item?: Array<{
          Name?: string;
          Value?: string | number;
        }>;
      };
    };
  };
};

function callbackAmount(callback: NonNullable<MpesaCallback["Body"]>["stkCallback"]): number | undefined {
  const item = callback?.CallbackMetadata?.Item?.find((entry) => entry.Name === "Amount");
  return typeof item?.Value === "number" ? item.Value : Number(item?.Value);
}

export async function POST(request: NextRequest) {
  if (!verifyMpesaCallbackToken(request.nextUrl.searchParams.get("token"))) {
    return failure(new AppError("INVALID_WEBHOOK_SIGNATURE", "Invalid M-Pesa callback token.", 401));
  }

  const rawPayload = await request.text();
  const body = JSON.parse(rawPayload) as MpesaCallback;
  const callback = body.Body?.stkCallback;
  const checkoutRequestId = callback?.CheckoutRequestID;
  if (!checkoutRequestId) {
    return failure(new AppError("INVALID_WEBHOOK_PAYLOAD", "M-Pesa callback did not include a checkout request ID.", 400));
  }

  const webhook = await beginWebhook({
    provider: Provider.MPESA,
    externalEventId: (callback?.MerchantRequestID || "") + ":" + checkoutRequestId,
    rawPayload,
    signatureValid: true,
  });
  if (webhook.duplicate) {
    return success({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  try {
    const resultCode = callback?.ResultCode;
    if (resultCode !== 0) {
      await markFundingIntentFailed({
        provider: Provider.MPESA,
        providerReference: checkoutRequestId,
        failureCode: callback?.ResultDesc || "MPESA_DECLINED",
      });
      await completeWebhook(webhook.id, { success: true });
      return success({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const intent = await getDb().paymentIntent.findFirst({
      where: {
        provider: Provider.MPESA,
        providerReference: checkoutRequestId,
      },
    });
    const amount = callbackAmount(callback);
    const expectedAmount = intent ? Number(intent.amountMinor / 100n) : undefined;
    if (!intent || amount !== expectedAmount) {
      if (intent) {
        await getDb().paymentIntent.update({
          where: { id: intent.id },
          data: {
            status: "MANUAL_REVIEW",
            failureCode: "MPESA_AMOUNT_MISMATCH",
          },
        });
      }
      throw new AppError("WEBHOOK_PAYMENT_MISMATCH", "M-Pesa payment did not match a pending intent.", 409);
    }

    await settleFundingIntent({
      paymentIntentId: intent.id,
      providerReference: checkoutRequestId,
    });
    await completeWebhook(webhook.id, { success: true });
    return success({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    await rejectWebhook(
      webhook.id,
      error instanceof Error ? error.message : "Unknown M-Pesa callback failure.",
    );
    return failure(error);
  }
}
