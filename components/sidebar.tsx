"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

export default function Sidebar() {
  const pathname = usePathname();

  // Daftar menu (aktifkan path nyata saat halaman siap)
  const items: { label: string; href: string; enabled?: boolean }[] = [
    { label: "Leads", href: "/leads", enabled: true },
    { label: "Banks", href: "/banks", enabled: true },
    { label: "Deposits", href: "/deposits", enabled: true },
    { label: "Withdrawals", href: "/withdrawals", enabled: true },
    { label: "Pending Deposits", href: "/pending_deposits", enabled: true },
    { label: "Interbank Transfer", href: "/interbank_transfers", enabled: true },
    { label: "Bank Adjustment", href: "/bank_adjustments", enabled: true },
    { label: "Expenses", href: "/bank_expenses", enabled: true },
    { label: "Bank Mutation", href: "/bank_mutations", enabled: true },
    { label: "Bank Management", href: "/bank_managements", enabled: true },
    { label: "Credit Topup", href: "#", enabled: false },
    { label: "Credit Adjustment", href: "#", enabled: false },
    { label: "Credit Mutation", href: "/credit_mutations", enabled: true },
    { label: "Credit Report", href: "#", enabled: false },
    { label: "User Management", href: "#", enabled: false },
  ];

  return (
    <aside className="w-[220px] shrink-0 border-r bg-white min-h-[calc(100vh-56px)]">
      <div className="px-3 py-3 font-semibold">TECH</div>
      <nav className="px-2 pb-6">
        <ul className="space-y-1">
          {items.map((it) => {
            const active = pathname === it.href;
            const className = clsx(
              "block rounded px-3 py-2 text-sm",
              active
                ? "bg-blue-50 text-blue-700 font-medium"
                : "text-gray-700 hover:bg-gray-50",
              !it.enabled && "opacity-50 cursor-not-allowed"
            );
            return it.enabled ? (
              <li key={it.label}>
                <Link href={it.href} className={className}>
                  {it.label}
                </Link>
              </li>
            ) : (
              <li key={it.label}>
                <span className={className}>{it.label}</span>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
