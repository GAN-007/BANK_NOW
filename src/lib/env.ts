import { z } from "zod";

const optionalString = z.string().trim().optional().transform((value) => value || undefined);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  SESSION_PEPPER: z.string().min(32),
  FIELD_ENCRYPTION_KEY: z.string().min(40),
  APP_NAME: z.string().min(1).default("BANK NOW"),
  DEFAULT_CURRENCY: z.string().length(3).default("KES"),
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: z.string().min(3).default("Bank Now <no-reply@example.com>"),
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  PAYPAL_CLIENT_ID: optionalString,
  PAYPAL_CLIENT_SECRET: optionalString,
  PAYPAL_WEBHOOK_ID: optionalString,
  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  MPESA_CONSUMER_KEY: optionalString,
  MPESA_CONSUMER_SECRET: optionalString,
  MPESA_SHORTCODE: optionalString,
  MPESA_PASSKEY: optionalString,
  MPESA_CALLBACK_URL: optionalString,
  MPESA_CALLBACK_SECRET: optionalString,
  MPESA_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  BANK_TRANSFER_BANK_NAME: optionalString,
  BANK_TRANSFER_ACCOUNT_NAME: optionalString,
  BANK_TRANSFER_ACCOUNT_NUMBER: optionalString,
  BANK_TRANSFER_BRANCH: optionalString,
});

export type AppEnvironment = z.infer<typeof environmentSchema>;

let environment: AppEnvironment | undefined;

function validateEncryptionKey(value: string): void {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
}

export function getEnv(): AppEnvironment {
  if (environment) {
    return environment;
  }

  const parsed = environmentSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      "Invalid runtime environment: " +
        parsed.error.issues.map((issue) => issue.path.join(".")).join(", "),
    );
  }

  validateEncryptionKey(parsed.data.FIELD_ENCRYPTION_KEY);

  if (parsed.data.NODE_ENV === "production" && !parsed.data.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is required in production.");
  }

  environment = parsed.data;
  return environment;
}

export function resetEnvironmentForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Environment cache can only be reset while testing.");
  }
  environment = undefined;
}
