import Link from "next/link";
import { CircleAlert } from "lucide-react";

export function ComplianceAlert({
  emailVerified,
  kycStatus,
}: {
  emailVerified: boolean;
  kycStatus: string;
}) {
  if (emailVerified && kycStatus === "VERIFIED") {
    return null;
  }

  const explanation = !emailVerified
    ? "Verify your e-mail before you can add or transfer money."
    : "Identity verification is required before money movement is enabled.";

  return (
    <aside className="compliance-alert">
      <CircleAlert aria-hidden="true" size={20} />
      <div>
        <strong>Money movement is currently restricted</strong>
        <p>{explanation}</p>
      </div>
      <Link href="/security">Review security</Link>
    </aside>
  );
}
