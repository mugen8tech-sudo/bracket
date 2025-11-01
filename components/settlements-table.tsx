"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type SettlementRow = {
  id: number;
  bank_id: number;
  entry: "IN" | "OUT";
  amount: number; // signed
  fee: number;
  description: string | null;
  target_bank_provider: string;
  target_account_name: string | null;
  target_account_number: string | null;
  txn_at: string;
  performed_at: string;
  created_by: string;
};

type BankLite = { id: number; bank_code: string; account_name: string; account_no: string };
type ProfileLite = { user_id: string; full_name: string | null };

function fmtIdDateTime(d: string) {
  const dt = new Date(d);
  const date = dt.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" });
  const time = dt
    .toLocaleTimeString("id-ID", { hour12: false, timeZone: "Asia/Jakarta" })
    .replace(/:/g, ".");
  return `${date}, ${time}`;
}

const PAGE_SIZE = 25;

export default function SettlementsTable() {
  const supabase = supabaseBrowser();

  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [banksMap, setBanksMap] = useState<Record<number, BankLite>>({});
  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});
  const [brand, setBrand] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = async (pageToLoad = page) => {
    setLoading(true);

    // List settlements (performed_at desc, id desc) + count
    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, count, error } = await supabase
      .from("settlements")
      .select(
        "id, bank_id, entry, amount, fee, description, target_bank_provider, target_account_name, target_account_number, txn_at, performed_at, created_by",
        { count: "exact" }
      )
      .order("performed_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error) {
      setLoading(false);
      alert(error.message);
      return;
    }
    const list = (data as SettlementRow[]) ?? [];
    setRows(list);
    setTotal(count ?? list.length);
    setPage(pageToLoad);

    // lookups
    const bankIds = new Set<number>();
    const userIds = new Set<string>();
    for (const r of list) {
      bankIds.add(r.bank_id);
      if (r.created_by) userIds.add(r.created_by);
    }

    const [bankRes, profRes, meRes] = await Promise.all([
      bankIds.size
        ? supabase
            .from("banks")
            .select("id, bank_code, account_name, account_no")
            .in("id", Array.from(bankIds))
        : Promise.resolve({ data: [] as any[] }),
      userIds.size
        ? supabase
            .from("profiles")
            .select("user_id, full_name")
            .in("user_id", Array.from(userIds))
        : Promise.resolve({ data: [] as any[] }),
      supabase.auth.getUser(),
    ]);

    const banks = (bankRes.data as BankLite[]) ?? [];
    setBanksMap(Object.fromEntries(banks.map((b) => [b.id, b])));

    const profs = (profRes.data as ProfileLite[]) ?? [];
    setProfilesMap(
      Object.fromEntries(profs.map((p) => [p.user_id, p.full_name ?? p.user_id]))
    );

    // Brand/Website = tenant user aktif
    const uid = meRes.data.user?.id;
    if (uid) {
      const me = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", uid)
        .single();
      const t = me.data?.tenant_id
        ? await supabase
            .from("tenants")
            .select("name")
            .eq("id", me.data.tenant_id)
            .maybeSingle()
        : null;
      if (t?.data?.name) setBrand(t.data.name);
    }

    setLoading(false);
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bankLabel = (id: number) => {
    const b = banksMap[id];
    return b ? `[${b.bank_code}] ${b.account_name} - ${b.account_no}` : "—";
  };

  return (
    <div className="space-y-3">
      <div className="rounded border bg-white p-3">
        <b>Settlements</b>
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1200px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* HEADER (tanpa filter, mengikuti gaya Interbank) */}
            <tr>
              <th className="text-left w-16">ID</th>
              <th className="text-left w-28">Website</th>
              <th className="text-left w-[320px]">Bank</th>
              <th className="text-right w-36">Amount</th>
              <th className="text-left w-[320px]">Description</th>
              <th className="text-left w-[320px]">Target</th>
              <th className="text-left w-56">Tgl</th>
              <th className="text-left w-40">By</th>
              <th className="text-left w-24">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9}>Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9}>No data</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td>{r.id}</td>
                  <td>{brand || "—"}</td>
                  <td>{bankLabel(r.bank_id)}</td>
                  <td className="text-right">{formatAmount(r.amount)}</td>
                  <td>{r.description ?? ""}</td>
                  <td>
                    {r.target_bank_provider}
                    {r.target_account_name ? ` - ${r.target_account_name}` : ""}
                    {r.target_account_number ? ` - ${r.target_account_number}` : ""}
                  </td>
                  <td>{fmtIdDateTime(r.performed_at)}</td>
                  <td>{profilesMap[r.created_by] ?? r.created_by}</td>
                  <td>
                    <Link
                      href={`/settlements/${r.id}`}
                      className="rounded bg-gray-100 px-3 py-1 inline-block"
                    >
                      Detail
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm">
          <button
            onClick={() => page > 1 && load(1)}
            disabled={page <= 1}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            First
          </button>
          <button
            onClick={() => page > 1 && load(page - 1)}
            disabled={page <= 1}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 rounded border bg-white">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => page < totalPages && load(page + 1)}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={() => page < totalPages && load(totalPages)}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Last
          </button>
        </nav>
      </div>
    </div>
  );
}
