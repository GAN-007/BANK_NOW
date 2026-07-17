import { Resend } from "resend";

import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";

type EmailMessage = {
  to: string;
  subject: string;
  html: string;
};

export async function sendTransactionalEmail(
  message: EmailMessage,
): Promise<{ developmentPreview: boolean }> {
  const environment = getEnv();

  if (!environment.RESEND_API_KEY) {
    if (environment.NODE_ENV === "production") {
      throw new AppError(
        "EMAIL_DELIVERY_UNAVAILABLE",
        "E-mail delivery is temporarily unavailable. Try again shortly.",
        503,
      );
    }

    console.info("EMAIL_DELIVERY_SKIPPED_IN_NON_PRODUCTION", {
      subject: message.subject,
    });
    return { developmentPreview: true };
  }

  const resend = new Resend(environment.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: environment.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    html: message.html,
  });

  if (result.error) {
    throw new AppError(
      "EMAIL_DELIVERY_UNAVAILABLE",
      "E-mail delivery is temporarily unavailable. Try again shortly.",
      503,
    );
  }

  return { developmentPreview: false };
}
