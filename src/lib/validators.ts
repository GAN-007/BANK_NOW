import { z } from "zod";

const uuid = z.string().uuid();
const currency = z.string().trim().length(3).transform((value) => value.toUpperCase());
const amount = z.string().trim().min(1).max(20);

export const registerSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.email().max(320),
  phoneNumber: z.string().trim().min(10).max(20).optional(),
  password: z.string().min(1).max(128),
});

export const loginSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(128),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(32).max(256),
});

export const requestPasswordResetSchema = z.object({
  email: z.email().max(320),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(1).max(128),
});

export const mfaLoginSchema = z.object({
  challengeToken: z.string().min(32).max(256),
  code: z.string().trim().min(6).max(20),
});

export const mfaCodeSchema = z.object({
  code: z.string().trim().min(6).max(20),
});

export const passwordReauthenticationSchema = z.object({
  password: z.string().min(1).max(128),
});

export const transferSchema = z.object({
  sourceAccountId: uuid,
  destinationAccountNumber: z.string().trim().regex(/^\d{13}$/),
  amount,
  currency,
  memo: z.string().trim().min(1).max(140).optional(),
  idempotencyKey: uuid,
});

export const recipientLookupSchema = z.object({
  sourceAccountId: uuid,
  accountNumber: z.string().trim().regex(/^\d{13}$/),
});

export const statementQuerySchema = z.object({
  accountId: uuid,
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const fundingSchema = z
  .object({
    accountId: uuid,
    amount,
    currency,
    method: z.enum(["MPESA", "BANK_TRANSFER", "CARD", "PAYPAL"]),
    phoneNumber: z.string().trim().min(10).max(20).optional(),
    idempotencyKey: uuid,
  })
  .superRefine((value, context) => {
    if (value.method === "MPESA" && !value.phoneNumber) {
      context.addIssue({
        code: "custom",
        path: ["phoneNumber"],
        message: "A phone number is required for M-Pesa funding.",
      });
    }
    if (value.method !== "MPESA" && value.phoneNumber) {
      context.addIssue({
        code: "custom",
        path: ["phoneNumber"],
        message: "A phone number is accepted only for M-Pesa funding.",
      });
    }
  });

export const paypalCaptureSchema = z.object({
  orderId: z.string().trim().min(1).max(128),
});

export const revokeSessionSchema = z.object({
  sessionId: uuid,
});

export const settlementReviewRequestSchema = z.object({
  settlementReference: z.string().trim().min(4).max(128),
  evidenceReference: z.string().trim().min(4).max(500),
  reason: z.string().trim().min(20).max(500),
  idempotencyKey: uuid,
});

export const settlementReviewRejectionSchema = z.object({
  reason: z.string().trim().min(20).max(500),
});

const positiveMinorUnits = z.string().trim().regex(/^[1-9]\d*$/, {
  message: "Enter a positive integer number of minor currency units.",
});

export const transactionPolicySchema = z
  .object({
    currency,
    enabled: z.boolean(),
    maximumAmountMinor: positiveMinorUnits,
    rolling24HourAmountLimitMinor: positiveMinorUnits,
    rolling24HourCountLimit: z.number().int().min(1).max(10_000),
  })
  .superRefine((value, context) => {
    if (
      BigInt(value.rolling24HourAmountLimitMinor) <
      BigInt(value.maximumAmountMinor)
    ) {
      context.addIssue({
        code: "custom",
        path: ["rolling24HourAmountLimitMinor"],
        message: "The rolling amount limit cannot be below the per-transfer limit.",
      });
    }
  });

export const kycDecisionSchema = z
  .object({
    status: z.enum(["PENDING", "MANUAL_REVIEW", "VERIFIED", "REJECTED"]),
    provider: z.string().trim().min(2).max(64).optional(),
    providerReference: z.string().trim().min(2).max(256).optional(),
    rejectionReason: z.string().trim().min(4).max(500).optional(),
  })
  .superRefine((value, context) => {
    if (value.status === "REJECTED" && !value.rejectionReason) {
      context.addIssue({
        code: "custom",
        path: ["rejectionReason"],
        message: "A rejection reason is required when identity verification is rejected.",
      });
    }
  });
