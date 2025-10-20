import "./globals.css";
import type { Metadata } from "next";
import ThemeScript from "@/components/theme-script";

export const metadata: Metadata = {
  title: "Bracket BANK",
  description: "Multi-tenant CRM • TECH",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className="bg-gray-50 min-h-screen">
        <ThemeScript />
        {children}
      </body>
    </html>
  );
}
