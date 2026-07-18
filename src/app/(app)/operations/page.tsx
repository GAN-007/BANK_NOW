import { redirect } from "next/navigation";

import { OperationsConsole } from "@/components/operations-console";
import { getCurrentSession } from "@/lib/auth/session";

export const metadata = {
  title: "Operations",
};

const staffRoles = new Set([
  "COMPLIANCE",
  "FINANCE_ADMIN",
  "PLATFORM_ADMIN",
]);

export default async function OperationsPage() {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/sign-in");
  }
  if (!staffRoles.has(session.user.role)) {
    redirect("/dashboard");
  }

  return (
    <OperationsConsole
      actorId={session.user.id}
      role={session.user.role as
        | "COMPLIANCE"
        | "FINANCE_ADMIN"
        | "PLATFORM_ADMIN"}
    />
  );
}
