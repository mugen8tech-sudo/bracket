"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/** ================= Helpers ================= **/
const PAGE_SIZE = 50;

function yyyymmddJakarta(d = new Date()) {
  // default ke hari ini (Asia/Jakarta)
  const opts: Intl.DateTimeFormatOptions = { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" } as any;
  const [m, d2, y] = new Intl.DateTimeFormat("id-ID", opts)
    .format(d)
    .split("/")
    .map((s) => s.padStart(2, "0"));
  return `${y}-${m}-${d2}`;
}
function startOfDayJakartaISO(dateStr: string) {
  return new Date(`${dateStr}T00:00:00+07:00`).toISOString();
}
function endOfDayJakartaISO(dateStr: string) {
  return new Date(`${dateStr}T23:59:59.999+07:00`).toISOString();
}

type Row = {
  id: number;
  tenant_id: string;
  deposit_id: number | null;
  kind: "deposit" | "withdraw" | "adjustment" | "topup" | string;
  amount: number;
  credit_before: number;
  credit_after: number;
  txn_at: string;          // waktu dipilih (backdate)
  performed_at: string;    // waktu klik (real)
  description: string | null;
  created_at: string;
  created_by: string | null;
};

type ProfileName = { user_id: string; full_name: string | null };

const CAT_TO_KIND: Record<"ALL" | "DP" | "WD" | "ADJ" | "TOPUP", string | null> = {
  ALL: null,
  DP: "deposit",
  WD: "withdraw",
  ADJ: "adjustment",
  TOPUP: "topup",
};

export default function CreditMutationsTable() {
  const supabase = supabaseBrowser();

  /** ====== header: saldo tenant ====== */
  const [tenantBalance, setTenantBalance] = useState<number>(0);

  /** ====== filters ====== */
  const [fId, setFId] = useState<string>("");
  const [fStart, setFStart] = useState<string>(yyyymmddJakarta());
  const [fFinish, setFFinish] = useState<string>(yyyymmddJakarta());
  const [fCat, setFCat] = useState<"ALL" | "DP" | "WD" | "ADJ" | "TOPUP">("ALL");
  const [fDesc, setFDesc] = useState<string>("");

  /** ====== list & pagination ====== */
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [loading, setLoading] = useState(true);

  /** ====== creator name map ====== */
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  /** ====== load tenant credit (balance sekarang) ====== */
  const loadTenantCredit = useCallback(async () => {
    const {
      data: { user },
      error: eUser,
    } = await supabase.auth.getUser();
    if (eUser || !user) return;

    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", user.id)
      .single();

    if (prof?.tenant_id) {
      const { data: t } = await supabase
        .from("tenants")
        .select("credit_balance")
        .eq("id", prof.tenant_id)
        .single();
      setTenantBalance(Number(t?.credit_balance || 0));
    }
  }, [supabase]);

  /** ====== build query ====== */
  const buildQuery = useCallback(() => {
    let q = supabase
      .from("credit_mutations")
      .select("*", { count: "exact" })
      .order("performed_at", { ascending: false });

    if (fId.trim()) {
      const asNum = Number(fId.trim());
      if (!Number.isNaN(asNum)) q = q.eq("id", asNum);
    }
    // filter waktu pada Waktu Click (performed_at)
    if (fStart) q = q.gte("performed_at", startOfDayJakartaISO(fStart));
    if (fFinish) q = q.lte("performed_at", endOfDayJakartaISO(fFinish));

    const kind = CAT_TO_KIND[fCat];
    if (kind) q = q.eq("kind", kind);

    if (fDesc.trim()) q = q.ilike("description", `%${fDesc.trim()}%`);

    return q;
  }, [supabase, fId, fStart, fFinish, fCat, fDesc]);

  /** ====== load rows ====== */
  const load = useCallback(
    async (pageToLoad = page) => {
      setLoading(true);
      const from = (pageToLoad - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error, count } = await buildQuery().range(from, to);
      setLoading(false);
      if (error) {
        alert(error.message);
        return;
      }
      const list = (data as Row[]) ?? [];
      setRows(list);
      setTotal(count ?? 0);
      setPage(pageToLoad);

      // ambil nama Creator (profiles.full_name)
      const ids = Array.from(
        new Set(list.map((r) => r.created_by).filter(Boolean) as string[])
      );
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", ids);
        const m: Record<string, string> = {};
        (profs as ProfileName[] | null)?.forEach((p) => {
          if (p.user_id) m[p.user_id] = p.full_name ?? p.user_id;
        });
        setNameMap(m);
      } else {
        setNameMap({});
      }
    },
    [buildQuery, page, supabase]
  );

  /** ====== first load: default hari ini + saldo ====== */
  useEffect(() => {
    loadTenantCredit();
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters: React.FormEventHandler = (e) => {
    e.preventDefault();
    load(1);
  };

  const canPrev = page > 1;
  const canNext = page < totalPages;

  /** ====== Render ====== */
  return (
    <div className="space-y-3">
      {/* Header saldo */}
      <div className="rounded border bg-white p-3 text-sm">
        <b>Credit Mutations.</b> Balance sekarang {formatAmount(tenantBalance)}
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1100px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* Baris FILTERS (di atas header) */}
            <tr className="filters">
              <th className="w-24">
                <input
                  placeholder="Cari ID"
                  value={fId}
                  onChange={(e) => setFId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && load(1)}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              {/* Waktu Click filter (Start/Finish) */}
              <th className="w-60">
                <div className="flex flex-col gap-1">
                  <input
                    type="date"
                    value={fStart}
                    onChange={(e) => setFStart(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Start (Click)"
                  />
                  <input
                    type="date"
                    value={fFinish}
                    onChange={(e) => setFFinish(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Finish (Click)"
                  />
                </div>
              </th>
              {/* Waktu dipilih tidak difilter, hanya ditampilkan */}
              <th className="w-60"></th>

              <th className="w-28">
                <select
                  value={fCat}
                  onChange={(e) => setFCat(e.target.value as any)}
                  className="border rounded px-2 py-1"
                >
                  <option value="ALL">All</option>
                  <option value="DP">DP</option>
                  <option value="WD">WD</option>
                  <option value="ADJ">Adjustment</option>
                  <option value="TOPUP">Topup</option>
                </select>
              </th>
              <th>
                <input
                  placeholder="Desc"
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && load(1)}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th className="w-28"></th>
              <th className="w-28"></th>
              <th className="w-28"></th>
              <th className="w-32">
                <button onClick={applyFilters} className="rounded bg-blue-600 text-white px-3 py-1">
                  submit
                </button>
              </th>
            </tr>

            {/* Header kolom */}
            <tr>
              <th className="text-left w-24">ID</th>
              <th className="text-left w-60">Waktu Click</th>
              <th className="text-left w-60">Waktu dipilih</th>
              <th className="text-left w-20">Cat</th>
              <th className="text-left min-w-[280px]">Desc</th>
              <th className="text-left w-28">Amount</th>
              <th className="text-left w-28">Start</th>
              <th className="text-left w-28">Finish</th>
              <th className="text-left w-44">Creator</th>
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
                <tr key={r.id}>
                  <td>{r.id}</td>

                  <td>
                    {new Date(r.performed_at).toLocaleString("id-ID", {
                      timeZone: "Asia/Jakarta",
                    })}
                  </td>

                  <td>
                    {new Date(r.txn_at).toLocaleString("id-ID", {
                      timeZone: "Asia/Jakarta",
                    })}
                  </td>

                  <td>
                    {r.kind === "deposit"
                      ? "DP"
                      : r.kind === "withdraw"
                      ? "WD"
                      : r.kind === "adjustment"
                      ? "ADJ"
                      : r.kind === "topup"
                      ? "TOPUP"
                      : r.kind}
                  </td>

                  <td className="whitespace-pre-wrap break-words">
                    {r.description ?? "-"}
                  </td>

                  <td>{formatAmount(r.amount)}</td>
                  <td>{formatAmount(r.credit_before)}</td>
                  <td>{formatAmount(r.credit_after)}</td>

                  <td>{r.created_by ? nameMap[r.created_by] ?? r.created_by : "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button
            onClick={() => {
              if (!canPrev) return;
              setPage(1);
              load(1);
            }}
            disabled={!canPrev}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            First
          </button>
          <button
            onClick={() => {
              if (!canPrev) return;
              load(page - 1);
            }}
            disabled={!canPrev}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 rounded border bg-white">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => {
              if (!canNext) return;
              load(page + 1);
            }}
            disabled={!canNext}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={() => {
              if (!canNext) return;
              load(totalPages);
            }}
            disabled={!canNext}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Last
          </button>
        </nav>
      </div>
    </div>
  );
}
