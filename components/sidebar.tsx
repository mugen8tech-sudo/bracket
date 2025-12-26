"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const LS_KEY = "sidebar:collapsed";

// ----- Role helpers (samakan dengan Banks, UserManagement, dll) -----
type AppRole = "admin" | "cs" | "cs_dp" | "cs_wd" | "operator" | "viewer";
type AnyRole = AppRole | "other";

function normalizeRole(r?: string | null): AnyRole {
  const v = (r || "").toLowerCase();
  if (v === "admin") return "admin";
  if (v === "cs" || v === "assops") return "cs";
  if (v === "cs_dp") return "cs_dp";
  if (v === "cs_wd") return "cs_wd";
  if (v === "operator") return "operator";
  if (v === "viewer" || v === "agent") return "viewer";
  return "other";
}

type SidebarItem = {
  label: string;
  href: string;
  enabled?: boolean;
  // Optional: daftar role yang boleh melihat menu ini.
  // Jika undefined → bisa dilihat semua role.
  roles?: AppRole[];
};

export default function Sidebar() {
  const pathname = usePathname();
  const supabase = supabaseBrowser();

  const [tenantName, setTenantName] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [role, setRole] = useState<AnyRole>("other");

  // Persist state
  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    if (saved === "1") setCollapsed(true);
  }, []);
  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined")
        localStorage.setItem(LS_KEY, next ? "1" : "0");
      return next;
    });
  };

  // Load tenant + role
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("tenant_id, role")
        .eq("user_id", user.id)
        .single();

      const tid = prof?.tenant_id ?? "";
      if (tid) {
        const { data: t } = await supabase
          .from("tenants")
          .select("name")
          .eq("id", tid)
          .single();
        setTenantName(t?.name ?? "");
      }

      setRole(normalizeRole((prof as any)?.role));
    })();
  }, [supabase]);

  const items: SidebarItem[] = [
    { label: "Leads", href: "/leads", enabled: true },
    { label: "Banks", href: "/banks", enabled: true },
    { label: "Deposits", href: "/deposits", enabled: true },
    { label: "Withdrawals", href: "/withdrawals", enabled: true },
    {
      label: "Import Data Panel",
      href: "/import_data_panel",
      enabled: true,
      roles: ["admin", "operator", "cs", "cs_dp", "cs_wd"],
    },
    { label: "Pending Deposits", href: "/pending_deposits", enabled: true },
    { label: "Interbank Transfer", href: "/interbank_transfers", enabled: true },

    // Bank Adjustment (Adj) → hanya admin & operator
    {
      label: "Bank Adjustment",
      href: "/bank_adjustments",
      enabled: true,
      roles: ["admin", "operator"],
    },

    // Expenses (Biaya) → hanya admin & operator
    {
      label: "Expenses",
      href: "/bank_expenses",
      enabled: true,
      roles: ["admin", "operator"],
    },

    {
      label: "Export Data Panel",
      href: "/export_data_bracket",
      enabled: true,
      roles: ["admin", "operator", "cs", "cs_dp", "cs_wd"],
    },

    // Akuran (Settlements) → hanya admin
    {
      label: "Akuran",
      href: "/settlements",
      enabled: true,
      roles: ["admin"],
    },

    { label: "Bank Mutation", href: "/bank_mutations", enabled: true },
    {
      label: "Bank Management",
      href: "/bank_managements",
      enabled: true,
      roles: ["admin", "operator"],
    },
    { label: "Credit Topup", href: "/credit_topups", enabled: true },
    // kecil typo sebelumnya: tambahkan "/" di depan
    { label: "Credit Adjustment", href: "/credit_adjustments", enabled: true },
    { label: "Credit Mutation", href: "/credit_mutations", enabled: true },
    { label: "Credit Report", href: "/credit_reports", enabled: true },

    // User Management → hanya admin (sama dengan guard di halamannya)
    {
      label: "User Management",
      href: "/users",
      enabled: true,
      roles: ["admin"],
    },
  ];

  // Filter item sesuai role (item.roles undefined = bebas)
  const visibleItems = items.filter((it) => {
    if (it.enabled === false) return false;
    if (!it.roles || it.roles.length === 0) return true;
    if (role === "other") return false; // role belum dikenal → hide item yang restricted
    return it.roles.includes(role as AppRole);
  });

  return (
    <aside
      id="app-sidebar"
      className={clsx(
        "shrink-0 border-r bg-white min_h-[calc(100vh-56px)] min-h-[calc(100vh-56px)] transition-[width] duration-200 ease-in-out",
        collapsed ? "w-12" : "w-[220px]",
      )}
    >
      <div
        className={clsx(
          "px-3 py-3 flex items-center",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {!collapsed && (
          <span className="font-semibold truncate">{tenantName}</span>
        )}

        {/* Toggle selalu ADA di dalam aside, bukan fixed */}
        <button
          type="button"
          onClick={toggleSidebar}
          className="rounded border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-expanded={!collapsed}
          aria-controls="app-sidebar"
          title={collapsed ? "Tampilkan sidebar" : "Sembunyikan sidebar"}
        >
          {collapsed ? "☰" : "Hide"}
        </button>
      </div>

      {/* Sembunyikan menu saat collapsed */}
      <nav className={clsx("px-2 pb-6", collapsed && "hidden")}>
        <ul className="space-y-1">
          {visibleItems.map((it) => {
            const active = pathname === it.href;
            const className = clsx(
              "block rounded px-3 py-2 text-sm",
              active
                ? "bg-blue-50 text-blue-700 font-medium"
                : "text-gray-700 hover:bg-gray-50",
            );
            return (
              <li key={it.label}>
                <Link href={it.href} className={className}>
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
