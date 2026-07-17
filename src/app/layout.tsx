import type { Metadata } from "next";

import "@/app/globals.css";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: {
    default: "BANK NOW",
    template: "%s | BANK NOW",
  },
  description: "A secure, mobile-first account and payments experience.",
  applicationName: "BANK NOW",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
