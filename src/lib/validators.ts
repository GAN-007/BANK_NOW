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

export const transferSchema = z.object({
  sourceAccountId: uuid,
  destinationAccountNumber: z.string().trim().regex(/^\d{13}$/),
  amount,
  currency,
  memo: z.string().trim().min(1).max(140).optional(),
  idempotencyKey: uuid,
});

export const fundingSchema = z.object({
  accountId: uuid,
  amount,
  currency,
  method: z.enum(["MPESA", "BANK_TRANSFER", "CARD", "PAYPAL"]),
  phoneNumber: z.string().trim().min(10).max(20).optional(),
  idempotencyKey: uuid,
});

export const paypalCaptureSchema = z.object({
  orderId: z.string().trim().min(1).max(128),
});

export const revokeSessionSchema = z.object({
  sessionId: uuid,
});

export const settleBankTransferSchema = z.object({
  settlementReference: z.string().trim().min(4).max(128),
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
