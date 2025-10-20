import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bracket BANK",
  description: "Multi-tenant CRM • TECH",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  );
}
