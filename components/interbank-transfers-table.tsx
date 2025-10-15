"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";
import Link from "next/link";

type IBTRow = {
  id: number;
  tenant_id: string;
  bank_from_id: number;
  bank_to_id: number;
  amount_gross: number;
  transfer_fee_amount: number | null;
  from_txn_at: string;
  to_txn_at: string;
  submitted_at: string;
  description: string | null;
  created_by: string;
};

type BankLite = { id: number; bank_code: string; account_name: string; account_no: string; };
type ProfileLite = { user_id: string; full_name: string | null };

function startOfDayJakartaISO(d: string) {
  return new Date(`${d}T00:00:00+07:00`).toISOString();
}
function endOfDayJakartaISO(d: string) {
  return new Date(`${d}T23:59:59.999+07:00`).toISOString();
}
function todayJakartaYMD() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
function fmtIdDateTime(d: string) {
  const dt = new Date(d);
  const date = dt.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" });
  const time = dt.toLocaleTimeString("id-ID", { hour12: false, timeZone: "Asia/Jakarta" }).replace(/:/g, ".");
  return `${date}, ${time}`;
}
const PAGE_SIZE = 50;

export default function InterbankTransfersTable() {
  const supabase = supabaseBrowser();

  const [rows, setRows] = useState<IBTRow[]>([]);
  const [banksMap, setBanksMap] = useState<Record<number, BankLite>>({});
  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [fStart, setFStart] = useState(todayJakartaYMD());
  const [fFinish, setFFinish] = useState(todayJakartaYMD());

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = async (pageToLoad = page) => {
    setLoading(true);

    // Query list TT
    let q = supabase
      .from("interbank_transfers")
      .select("*", { count: "exact" })
      .order("submitted_at", { ascending: false })
      .order("id", { ascending: false });

    if (fStart) q = q.gte("submitted_at", startOfDayJakartaISO(fStart));
    if (fFinish) q = q.lte("submitted_at", endOfDayJakartaISO(fFinish));

    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, count, error } = await q.range(from, to);
    if (error) { setLoading(false); alert(error.message); return; }
    const list = (data as IBTRow[]) ?? [];

    // Collect lookups
    const bankIds = new Set<number>();
    const userIds = new Set<string>();
    for (const r of list) {
      bankIds.add(r.bank_from_id); bankIds.add(r.bank_to_id);
      if (r.created_by) userIds.add(r.created_by);
    }

    const [bankRes, profRes] = await Promise.all([
      bankIds.size
        ? supabase.from("banks")
            .select("id, bank_code, account_name, account_no")
            .in("id", Array.from(bankIds))
        : Promise.resolve({ data: [] as any[] }),
      userIds.size
        ? supabase.from("profiles")
            .select("user_id, full_name")
            .in("user_id", Array.from(userIds))
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const banks = (bankRes.data as BankLite[]) ?? [];
    const profs = (profRes.data as ProfileLite[]) ?? [];

    setBanksMap(Object.fromEntries(banks.map(b => [b.id, b])));
    setProfilesMap(Object.fromEntries(profs.map(p => [p.user_id, p.full_name ?? p.user_id])));
    setRows(list);
    setTotal(count ?? list.length);
    setPage(pageToLoad);
    setLoading(false);
  };

  useEffect(() => { load(1); }, []); // eslint-disable-line

  const bankLabel = (id: number) => {
    const b = banksMap[id];
    return b ? `[${b.bank_code}] ${b.account_name} - ${b.account_no}` : "[]";
  };

  return (
    <div className="space-y-3">
      <div className="rounded border bg-white p-3">
        <b>Interbank Transfers</b>
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1100px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="filters">
              <th className="w-40">
                <input type="date" value={fStart} onChange={(e)=>setFStart(e.target.value)}
                       className="border rounded px-2 py-1 w-full" placeholder=", dd --- yyyy" />
              </th>
              <th className="w-40">
                <input type="date" value={fFinish} onChange={(e)=>setFFinish(e.target.value)}
                       className="border rounded px-2 py-1 w-full" placeholder=", dd --- yyyy" />
              </th>
              <th className="w-24">
                <button onClick={()=>load(1)} className="rounded bg-blue-600 text-white px-3 py-1">
                  Submit
                </button>
              </th>
            </tr>
            <tr>
              <th className="text-left w-16">ID</th>
              <th className="text-left w-[320px]">Bank Asal</th>
              <th className="text-left w-[320px]">Bank Tujuan</th>
              <th className="text-right w-36">Amount</th>
              <th className="text-left w-56">Tgl</th>
              <th className="text-left w-40">By</th>
              <th className="text-left w-24">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7}>No data</td></tr>
            ) : (
              rows.map(r => (
                <tr key={r.id} className="align-top">
                  <td>{r.id}</td>
                  <td>{bankLabel(r.bank_from_id)}</td>
                  <td>{bankLabel(r.bank_to_id)}</td>
                  <td className="text-right">{formatAmount(r.amount_gross)}</td>
                  <td>{fmtIdDateTime(r.submitted_at)}</td>
                  <td>{profilesMap[r.created_by] ?? r.created_by}</td>
                  <td>
                    <Link href={`/interbank_transfers/${r.id}`} className="rounded bg-gray-100 px-3 py-1 inline-block">
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
          <button onClick={()=>page>1 && load(1)} disabled={page<=1} className="px-3 py-1 rounded border bg-white disabled:opacity-50">First</button>
          <button onClick={()=>page>1 && load(page-1)} disabled={page<=1} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Previous</button>
          <span className="px-3 py-1 rounded border bg-white">Page {page} / {Math.max(1, Math.ceil(total/50))}</span>
          <button onClick={()=>page<totalPages && load(page+1)} disabled={page>=totalPages} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Next</button>
          <button onClick={()=>page<totalPages && load(totalPages)} disabled={page>=totalPages} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Last</button>
        </nav>
      </div>
    </div>
  );
}
