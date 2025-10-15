"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type MenuItem = {
  label: string;
  href: string;
  enabled?: boolean;                 // jika false → tampil non‑klik (placeholder)
  roles?: Array<"admin" | "cs" | "viewer">; // siapa yang boleh melihat item ini
};

export default function Sidebar() {
  const pathname = usePathname();
  const supabase = supabaseBrowser();

  const [brand, setBrand] = useState<string>("TECH");     // header kiri
  const [role, setRole] = useState<"admin" | "cs" | "viewer" | "other">("other");
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // Ambil role & tenant
      const { data: prof } = await supabase
        .from("profiles")
        .select("role, tenant_id")
        .eq("user_id", user.id)
        .single();

      setRole(normalizeRole(prof?.role));

      if (prof?.tenant_id) {
        // Ambil slug atau name untuk header brand
        const { data: tenant } = await supabase
          .from("tenants")
          .select("slug, name")
          .eq("id", prof.tenant_id)
          .single();
        setBrand(tenant?.slug || tenant?.name || "—");
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Definisikan menu + kebijakan akses
  const items: MenuItem[] = [
    { label: "Leads", href: "/leads", enabled: true, roles: ["admin", "cs", "viewer"] },
    { label: "Banks", href: "/banks", enabled: true, roles: ["admin", "cs", "viewer"] },
    { label: "Deposits", href: "/deposits", enabled: true, roles: ["admin", "cs", "viewer"] },
    { label: "Withdrawals", href: "/withdrawals", enabled: true, roles: ["admin", "cs", "viewer"] },
    { label: "Pending Deposits", href: "/pending_deposits", enabled: true, roles: ["admin", "cs", "viewer"] },
    { label: "Interbank Transfer", href: "/interbank_transfers", enabled: true, roles: ["admin", "cs", "viewer"] },
    { label: "Bank Adjustment", href: "/bank_adjustments", enabled: true, roles: ["admin", "cs", "viewer"] },
    { label: "Expenses", href: "#", enabled: false, roles: ["admin", "cs", "viewer"] },
    { label: "Bank Mutation", href: "/bank-mutation", enabled: true, roles: ["admin", "cs", "viewer"] },

    // Hanya ADMIN
    { label: "Bank Management", href: "/bank-management", enabled: true, roles: ["admin"] },

    // Admin + CS
    { label: "Credit Topup", href: "#", enabled: false, roles: ["admin", "cs"] },

    // Placeholder (belum aktif) – visible utk admin saja biar eksplisit
    { label: "Credit Adjustment", href: "#", enabled: false, roles: ["admin", "cs"] },
    { label: "Credit Mutation", href: "/credit_mutations", enabled: true, roles: ["admin", "cs"] },
    { label: "Credit Report", href: "#", enabled: false, roles: ["admin", "cs"] },

    // Placeholder – hanya ADMIN
    { label: "User Management", href: "#", enabled: false, roles: ["admin"] },
  ];

  // Saring menu berdasarkan role
  const visibleItems = items.filter((it) => {
    if (!it.roles || it.roles.length === 0) return true;
    if (role === "other") return false; // 'other' tidak punya akses ke item yg dibatasi
    return it.roles.includes(role);     // di sini 'role' sudah terspesialisasi ke "admin" | "cs" | "viewer"
  });

  return (
    <aside className="w-[220px] shrink-0 border-r bg-white min-h-[calc(100vh-56px)]">
      <div className="px-3 py-3 font-semibold">
        {loading ? "…" : brand}
      </div>

      <nav className="px-2 pb-6">
        <ul className="space-y-1">
          {visibleItems.map((it) => {
            const active = pathname === it.href; // sederhana & konsisten dgn file awal
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
                {/* placeholder (disabled) */}
                <span className={className}>{it.label}</span>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
