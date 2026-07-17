import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getCurrentSession } from "@/lib/auth/session";

export default async function ApplicationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/sign-in");
  }

  return (
    <AppShell
      user={{
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        email: session.user.email,
        emailVerified: Boolean(session.user.emailVerifiedAt),
        kycStatus: session.user.kycStatus,
      }}
    >
      {children}
    </AppShell>
  );
}
