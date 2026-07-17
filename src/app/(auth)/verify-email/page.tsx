import { VerifyEmailForm } from "@/components/verify-email-form";

export const metadata = {
  title: "Verify e-mail",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <VerifyEmailForm token={token} />;
}
