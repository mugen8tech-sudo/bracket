"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type CatCode = "DP" | "WD" | "ADJUSTMENT" | "TOPUP" | string;

type CreditMutationRow = {
  id: number;
  tenant_id: string;

  // waktu
  performed_at?: string | null; // waktu click (real)
  created_at?: string | null;   // fallback real time
  txn_at?: string | null;       // waktu dipilih
  txn_at_final?: string | null; // fallback waktu dipilih

  // kategori & keterangan
  category?: CatCode | null;           // contoh: DP, WD, ADJUSTMENT, TOPUP
  description?: string | null;

  // snapshot player (opsional, bantu fallback Desc)
  username_snapshot?: string | null;

  // nominal & saldo
  amount_delta: number;        // perubahan credit (+/-)
  balance_before: number;      // saldo credit sebelum
  balance_after: number;       // saldo credit sesudah

  // pembuat
  created_by?: string | null;
  created_by_name?: string | null;
};

const PAGE_SIZE = 50;

function toDateLocalJakarta(d: Date) {
  // ambil yyyy-mm-dd sesuai Asia/Jakarta
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
function startOfDayJakartaISO(dateStr: string) {
  return new Date(`${dateStr}T00:00:00+07:00`).toISOString();
}
function endOfDayJakartaISO(dateStr: string) {
  return new Date(`${dateStr}T23:59:59.999+07:00`).toISOString();
}
function toJakartaDateTimeString(iso?: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

export default function CreditMutationsTable() {
  const supabase = supabaseBrowser();

  // ========== Header summary ==========
  const [tenantCredit, setTenantCredit] = useState<number>(0);

  // ========== List & pagination ==========
  const [rows, setRows] = useState<CreditMutationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ========== Filters (tidak live; submit dulu) ==========
  const today = useMemo(() => toDateLocalJakarta(new Date()), []);
  const [fId, setFId] = useState<string>("");
  const [fCat, setFCat] = useState<"ALL" | "DP" | "WD" | "ADJUSTMENT" | "TOPUP">("ALL");
  const [fDesc, setFDesc] = useState<string>("");
  const [fStart, setFStart] = useState<string>(today);  // default hari ini
  const [fFinish, setFFinish] = useState<string>(today); // default hari ini

  // ambil credit tenant (untuk header)
  const loadTenantCredit = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", user?.id)
      .single();

    if (prof?.tenant_id) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("credit_balance")
        .eq("id", prof.tenant_id)
        .single();
      setTenantCredit(Number(tenant?.credit_balance ?? 0));
    }
  };

  // build query (filter diterapkan di applyFilters)
  const buildQuery = () => {
    let q = supabase
      .from("credit_mutations")
      .select("*", { count: "exact" })
      .order("id", { ascending: false }); // ID terbesar = terbaru

    // filter by ID (tepat)
    if (fId.trim()) {
      const asNum = Number(fId.trim());
      if (!Number.isNaN(asNum)) q = q.eq("id", asNum);
      else q = q.eq("id", -1); // paksa kosong jika bukan angka
    }

    // filter waktu click (real) -> kolom utama performed_at; fallback created_at
    if (fStart) {
      // gunakan or untuk fallback kolom waktu real
      const startISO = startOfDayJakartaISO(fStart);
      q = q.or(
        `performed_at.gte.${startISO},created_at.gte.${startISO}`
      );
    }
    if (fFinish) {
      const endISO = endOfDayJakartaISO(fFinish);
      q = q.or(
        `performed_at.lte.${endISO},created_at.lte.${endISO}`
      );
    }

    // filter kategori
    if (fCat !== "ALL") {
      // menerima dua kemungkinan penamaan: ADJUSTMENT vs ADJ (bila SQL pakai 'ADJ', tambahkan sendiri)
      if (fCat === "ADJUSTMENT") {
        q = q.in("category", ["ADJUSTMENT", "ADJ"]);
      } else {
        q = q.eq("category", fCat);
      }
    }

    // filter description
    if (fDesc.trim()) {
      q = q.ilike("description", `%${fDesc.trim()}%`);
    }

    return q;
  };

  const load = async (pageToLoad = page) => {
    setLoading(true);
    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error, count } = await buildQuery().range(from, to);
    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }
    setRows(((data as any[]) ?? []) as CreditMutationRow[]);
    setTotal(count ?? 0);
    setPage(pageToLoad);
  };

  useEffect(() => {
    loadTenantCredit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // default load (dengan filter hari ini)
  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters: React.FormEventHandler = (e) => {
    e.preventDefault();
    load(1);
  };

  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="space-y-3">
      {/* Header summary */}
      <div className="rounded border bg-white p-3 text-sm">
        <b>Credit Mutations.</b> Balance sekarang {formatAmount(tenantCredit)}
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1200px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* Baris FILTERS (letaknya seperti Leads/Deposits: di atas header) */}
            <tr className="filters">
              {/* ID */}
              <th className="w-24">
                <input
                  placeholder="Cari ID"
                  value={fId}
                  onChange={(e) => setFId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && load(1)}
                  className="w-full border rounded px-2 py-1"
                />
              </th>

              {/* Waktu Click (real): Start/Finish (stack) */}
              <th className="min-w-[240px]">
                <div className="text-xs font-semibold mb-1">Start (Click)</div>
                <input
                  type="date"
                  value={fStart}
                  onChange={(e) => setFStart(e.target.value)}
                  className="border rounded px-2 py-1 w-full mb-1"
                />
                <div className="text-xs font-semibold mb-1">Finish (Click)</div>
                <input
                  type="date"
                  value={fFinish}
                  onChange={(e) => setFFinish(e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                />
              </th>

              {/* Waktu Dipilih: hanya header kosong (filter khusus di atas adalah click-time) */}
              <th className="min-w-[200px]"></th>

              {/* Cat */}
              <th className="w-40">
                <select
                  value={fCat}
                  onChange={(e) => setFCat(e.target.value as any)}
                  className="border rounded px-2 py-1 w-full"
                >
                  <option value="ALL">All</option>
                  <option value="DP">DP</option>
                  <option value="WD">WD</option>
                  <option value="ADJUSTMENT">Adjustment</option>
                  <option value="TOPUP">Topup</option>
                </select>
              </th>

              {/* Desc */}
              <th className="min-w-[260px]">
                <input
                  placeholder="Desc"
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && load(1)}
                  className="w-full border rounded px-2 py-1"
                />
              </th>

              {/* Amount/Start/Finish/Creator: tidak ada filter di baris ini */}
              <th></th>
              <th></th>
              <th></th>
              <th className="whitespace-nowrap">
                <button
                  onClick={() => load(1)}
                  className="rounded bg-blue-600 text-white px-3 py-1"
                >
                  submit
                </button>
              </th>
            </tr>

            {/* HEADER kolom */}
            <tr>
              <th className="text-left w-24">ID</th>
              <th className="text-left min-w-[220px]">Waktu Click</th>
              <th className="text-left min-w-[200px]">Waktu dipilih</th>
              <th className="text-left w-28">Cat</th>
              <th className="text-left min-w-[280px]">Desc</th>
              <th className="text-left w-36">Amount</th>
              <th className="text-left w-40">Start</th>
              <th className="text-left w-40">Finish</th>
              <th className="text-left w-40">Creator</th>
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
              rows.map((r) => {
                const realTime = r.performed_at ?? r.created_at ?? null;
                const chosenTime = r.txn_at ?? r.txn_at_final ?? null;

                const desc =
                  (r.description && r.description.trim()) ||
                  (String(r.category).toUpperCase() === "DP" && r.username_snapshot
                    ? `Depo dari ${r.username_snapshot}`
                    : "-");

                // normalisasi kategori label
                const catLabel =
                  String(r.category || "")
                    .toUpperCase()
                    .replace("ADJ", "ADJUSTMENT") || "-";

                return (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{toJakartaDateTimeString(realTime)}</td>
                    <td>{toJakartaDateTimeString(chosenTime)}</td>
                    <td>{catLabel}</td>
                    <td className="whitespace-pre-wrap">{desc}</td>
                    <td className="text-left">{formatAmount(r.amount_delta)}</td>
                    <td className="text-left">{formatAmount(r.balance_before)}</td>
                    <td className="text-left">{formatAmount(r.balance_after)}</td>
                    <td>{r.created_by_name ?? r.created_by ?? "-"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
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
