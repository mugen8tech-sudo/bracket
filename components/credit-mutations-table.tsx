"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type CreditMutationRow = {
  id: number;
  tenant_id: string;
  deposit_id: number | null;
  kind: string; // enum di DB (deposit, withdrawal, adjustment, expense, dst.)
  amount: number; // delta (−/+)
  credit_before: number;
  credit_after: number;
  txn_at: string;         // waktu dipilih (backdate)
  performed_at: string;   // waktu klik (real)
  description: string | null;
  created_by: string | null; // user_id
};

type CatFilter = "ALL" | "DP" | "WD" | "ADJ" | "TOPUP";

const PAGE_SIZE = 50;

/** yyyy-mm-dd (Asia/Jakarta) */
function todayYmdJakarta() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
function startOfDayJakartaISO(ymd: string) {
  return new Date(`${ymd}T00:00:00+07:00`).toISOString();
}
function endOfDayJakartaISO(ymd: string) {
  return new Date(`${ymd}T23:59:59.999+07:00`).toISOString();
}

function kindToCat(kind?: string): string {
  const k = (kind ?? "").toLowerCase();
  if (k === "deposit") return "DP";
  if (k === "withdrawal") return "WD";
  if (k === "adjustment") return "ADJ";
  if (k === "topup" || k === "credit_topup") return "TOPUP";
  // jenis lain (mis. reversal) tetap ditampilkan apa adanya
  return k.toUpperCase() || "-";
}

function catToKinds(cat: CatFilter): string[] | null {
  switch (cat) {
    case "DP":
      return ["deposit"]; // reversal depo tetap punya desc "REVERSAL…" dan amount kebalikan
    case "WD":
      return ["withdrawal"];
    case "ADJ":
      return ["adjustment"];
    case "TOPUP":
      return ["topup", "credit_topup"];
    default:
      return null; // ALL
  }
}

export default function CreditMutationsTable() {
  const supabase = supabaseBrowser();

  // header balance tenant
  const [tenantBalance, setTenantBalance] = useState<number>(0);

  // tabel
  const [rows, setRows] = useState<CreditMutationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // map user_id -> full_name (untuk kolom Creator)
  const [creatorNameMap, setCreatorNameMap] = useState<Record<string, string>>(
    {}
  );

  // filters (default hari ini)
  const [fId, setFId] = useState<string>("");
  const [fStart, setFStart] = useState<string>(() => todayYmdJakarta());
  const [fFinish, setFFinish] = useState<string>(() => todayYmdJakarta());
  const [fCat, setFCat] = useState<CatFilter>("ALL");
  const [fDesc, setFDesc] = useState<string>("");

  // ---------- header: balance tenant ----------
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", user.id)
        .single();

      if (!prof?.tenant_id) return;

      const { data: tenant } = await supabase
        .from("tenants")
        .select("credit_balance")
        .eq("id", prof.tenant_id)
        .single();

      setTenantBalance(tenant?.credit_balance ?? 0);
    })();
  }, [supabase]);

  // ---------- query builder ----------
  const buildQuery = () => {
    let q = supabase
      .from("credit_mutations")
      .select("*", { count: "exact" })
      .order("id", { ascending: false });

    // filter waktu HANYA di performed_at (Waktu Click/Real)
    if (fStart) q = q.gte("performed_at", startOfDayJakartaISO(fStart));
    if (fFinish) q = q.lte("performed_at", endOfDayJakartaISO(fFinish));

    // filter ID (opsional)
    const idNum = Number(fId.trim());
    if (fId.trim() && Number.isFinite(idNum)) q = q.eq("id", idNum);

    // filter Cat -> kind
    const kinds = catToKinds(fCat);
    if (kinds && kinds.length > 0) q = q.in("kind", kinds);

    // filter Desc
    if (fDesc.trim()) q = q.ilike("description", `%${fDesc.trim()}%`);

    return q;
  };

  // ---------- load rows + creator names ----------
  const load = async (toPage = page) => {
    setLoading(true);
    const from = (toPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error, count } = await buildQuery().range(from, to);
    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    const list = (data as CreditMutationRow[]) ?? [];
    setRows(list);
    setTotal(count ?? 0);
    setPage(toPage);

    // map Creator (sekali panggil untuk semua id unik)
    const ids = [
      ...new Set(list.map((r) => r.created_by).filter(Boolean) as string[]),
    ];
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", ids);
      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: any) => {
        map[p.user_id] = p.full_name;
      });
      setCreatorNameMap(map);
    } else {
      setCreatorNameMap({});
    }
  };

  // pertama kali: load (default hari ini)
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
      <div className="rounded border bg-white p-3 text-sm">
        <b>Credit Mutations.</b> Balance sekarang {formatAmount(tenantBalance)}
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1200px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* Baris filter (di atas header) */}
            <tr className="filters">
              <th className="w-20">
                <input
                  placeholder="Cari ID"
                  value={fId}
                  onChange={(e) => setFId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && load(1)}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th className="w-56">
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
              <th className="w-52" />
              <th className="w-28">
                <select
                  value={fCat}
                  onChange={(e) => setFCat(e.target.value as CatFilter)}
                  className="border rounded px-2 py-1 w-full"
                >
                  <option>ALL</option>
                  <option>DP</option>
                  <option>WD</option>
                  <option>ADJ</option>
                  <option>TOPUP</option>
                </select>
              </th>
              <th className="w-[300px]">
                <input
                  placeholder="Desc"
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && load(1)}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th />
              <th />
              <th />
              <th className="w-28 text-left">
                <button
                  onClick={(e) => applyFilters(e as any)}
                  className="rounded bg-blue-600 text-white px-3 py-1"
                >
                  Submit
                </button>
              </th>
            </tr>

            <tr>
              <th className="text-left w-20">ID</th>
              <th className="text-left w-56">Waktu Click</th>
              <th className="text-left w-56">Waktu dipilih</th>
              <th className="text-left w-20">Cat</th>
              <th className="text-left min-w-[300px]">Desc</th>
              <th className="text-left w-32">Amount</th>
              <th className="text-left w-32">Start</th>
              <th className="text-left w-32">Finish</th>
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
                  <td>{kindToCat(r.kind)}</td>
                  <td className="whitespace-pre-wrap">
                    {r.description ?? "-"}
                  </td>
                  <td className="text-left">{formatAmount(r.amount)}</td>
                  <td className="text-left">{formatAmount(r.credit_before)}</td>
                  <td className="text-left">{formatAmount(r.credit_after)}</td>
                  <td>
                    {r.created_by ? creatorNameMap[r.created_by] ?? r.created_by : "-"}
                  </td>
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
            onClick={() => page > 1 && load(1)}
            disabled={page <= 1}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            First
          </button>
          <button
            onClick={() => page > 1 && load(page - 1)}
            disabled={!canPrev}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 rounded border bg-white">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => page < totalPages && load(page + 1)}
            disabled={!canNext}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={() => page < totalPages && load(totalPages)}
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
