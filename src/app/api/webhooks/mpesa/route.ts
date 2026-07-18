import { type NextRequest } from "next/server";

import { Provider } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { settleFundingIntent } from "@/lib/domain/ledger";
import { AppError } from "@/lib/errors";
import { failure, parseJsonText, readRawText, success } from "@/lib/http";
import {
  markFundingIntentFailed,
} from "@/lib/payments/service";
import { verifyMpesaCallbackToken } from "@/lib/payments/mpesa";
import {
  beginWebhook,
  completeWebhook,
  failWebhook,
  isPermanentWebhookFailure,
  rejectWebhook,
} from "@/lib/webhooks/store";

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

  let rawPayload: string;
  let body: MpesaCallback;
  try {
    rawPayload = await readRawText(request);
    body = parseJsonText<MpesaCallback>(rawPayload);
  } catch (error) {
    return failure(error);
  }
  const callback = body.Body?.stkCallback;
  const checkoutRequestId = callback?.CheckoutRequestID;
  if (!checkoutRequestId) {
    return failure(new AppError("INVALID_WEBHOOK_PAYLOAD", "M-Pesa callback did not include a checkout request ID.", 400));
  }

  const externalEventId = (callback?.MerchantRequestID || "") + ":" + checkoutRequestId;

  try {
    const webhook = await beginWebhook({
      provider: Provider.MPESA,
      externalEventId,
      rawPayload,
      signatureValid: true,
    });
    if (webhook.disposition === "in_progress") {
      return failure(
        new AppError("WEBHOOK_IN_PROGRESS", "This event is already being processed.", 503),
      );
    }
    if (webhook.disposition !== "claimed") {
      return success({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const resultCode = callback?.ResultCode;
    if (resultCode !== 0) {
      await markFundingIntentFailed({
        provider: Provider.MPESA,
        providerReference: checkoutRequestId,
        failureCode: callback?.ResultDesc || "MPESA_DECLINED",
      });
      await completeWebhook(webhook.id);
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
    if (!intent || !Number.isFinite(amount) || !Number.isInteger(amount) || amount !== expectedAmount) {
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
      settlementReference: checkoutRequestId,
    });
    await completeWebhook(webhook.id);
    return success({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown M-Pesa callback failure.";
    const existing = await getDb().providerWebhook.findUnique({
      where: {
        provider_externalEventId: {
          provider: Provider.MPESA,
          externalEventId,
        },
      },
      select: { id: true, status: true },
    });
    if (isPermanentWebhookFailure(error)) {
      if (existing?.status === "RECEIVED") {
        await rejectWebhook(existing.id, message);
      }
      return success({ ResultCode: 0, ResultDesc: "Accepted for manual review" });
    }
    if (existing?.status === "RECEIVED") {
      await failWebhook(existing.id, message);
    }
    return failure(error);
  }
}
