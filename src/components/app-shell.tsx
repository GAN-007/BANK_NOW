"use client";

import {
  ArrowLeftRight,
  LayoutDashboard,
  Landmark,
  LogOut,
  Menu,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { clientRequest } from "@/lib/client-api";

type ShellUser = {
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  kycStatus: string;
};

const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/transfer", label: "Transfer", icon: ArrowLeftRight },
  { href: "/payments", label: "Add funds", icon: WalletCards },
  { href: "/security", label: "Security", icon: ShieldCheck },
];

export function AppShell({
  user,
  children,
}: {
  user: ShellUser;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    setBusy(true);
    try {
      await clientRequest("/api/auth/logout", {
        method: "POST",
        csrf: true,
      });
      router.replace("/sign-in");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-frame">
      <button
        className="mobile-menu-button"
        type="button"
        aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X /> : <Menu />}
      </button>
      <aside className={mobileOpen ? "app-nav app-nav--open" : "app-nav"}>
        <Link className="brand" href="/dashboard" onClick={() => setMobileOpen(false)}>
          <span className="brand-mark">B</span>
          <span>
            <strong>BANK NOW</strong>
            <small>money, clearly</small>
          </span>
        </Link>
        <nav aria-label="Primary navigation">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                className={active ? "nav-link nav-link--active" : "nav-link"}
                href={item.href}
                key={item.href}
                onClick={() => setMobileOpen(false)}
              >
                <Icon aria-hidden="true" size={19} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="nav-user">
          <span className="avatar">{user.firstName.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.firstName} {user.lastName}</strong>
            <small>{user.email}</small>
          </div>
        </div>
        <button className="signout-button" type="button" disabled={busy} onClick={signOut}>
          <LogOut aria-hidden="true" size={18} />
          {busy ? "Signing out..." : "Sign out"}
        </button>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}
