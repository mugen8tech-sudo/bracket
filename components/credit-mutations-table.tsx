"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type CreditMutationRow = {
  id: number;
  tenant_id: string;
  deposit_id: number | null;
  kind:
    | "deposit"
    | "withdrawal"
    | "adjustment"
    | "transfer"
    | "expense"
    | "reversal"
    | "fee";
  amount: number; // delta ke credit (bisa + / -)
  credit_before: number;
  credit_after: number;
  txn_at: string; // waktu dipilih (backdate)
  performed_at: string; // waktu click (real)
  description: string | null;
  created_by: string | null;

  // embed (opsional)
  deposits?: {
    username_snapshot: string | null;
  } | null;
};

const PAGE_SIZE = 50;

function todayJakarta(): string {
  // yyyy-mm-dd
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
function startOfDayJakartaISO(d: string) {
  return new Date(`${d}T00:00:00+07:00`).toISOString();
}
function endOfDayJakartaISO(d: string) {
  return new Date(`${d}T23:59:59.999+07:00`).toISOString();
}

// label kategori singkat sesuai UI
function catLabel(kind: CreditMutationRow["kind"]): string {
  switch (kind) {
    case "deposit":
      return "DP";
    case "withdrawal":
      return "WD";
    case "adjustment":
      return "ADJ";
    case "fee":
      return "FEE";
    case "reversal":
      return "REV";
    default:
      return "-";
  }
}

export default function CreditMutationsTable() {
  const supabase = supabaseBrowser();

  // ===== header balance tenant =====
  const [tenantCredit, setTenantCredit] = useState<number>(0);

  // ===== data & pagination =====
  const [rows, setRows] = useState<CreditMutationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ===== filters =====
  const [fId, setFId] = useState<string>("");
  const [fStartClick, setFStartClick] = useState<string>(todayJakarta());
  const [fFinishClick, setFFinishClick] = useState<string>(todayJakarta());
  const [fCat, setFCat] = useState<"ALL" | "DP" | "WD" | "ADJ" | "TOPUP">(
    "ALL"
  );
  const [fDesc, setFDesc] = useState<string>("");

  // mapping kategori -> kind (enum DB)
  const catToKinds = useMemo(() => {
    switch (fCat) {
      case "DP":
        return ["deposit" as const];
      case "WD":
        return ["withdrawal" as const];
      case "ADJ":
        return ["adjustment" as const];
      case "TOPUP":
        // untuk saat ini topup credit juga ditulis sebagai adjustment (nanti bisa diubah bila enum baru ada)
        return ["adjustment" as const];
      default:
        return null; // ALL
    }
  }, [fCat]);

  // ===== load balance & data =====
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("tenant_id")
          .eq("user_id", user.id)
          .single();
        if (prof?.tenant_id) {
          const { data: tenant } = await supabase
            .from("tenants")
            .select("credit_balance")
            .eq("id", prof.tenant_id)
            .single();
          setTenantCredit(tenant?.credit_balance ?? 0);
        }
      }
    })();
  }, [supabase]);

  const load = async (pageToLoad = page) => {
    setLoading(true);
    try {
      const from = (pageToLoad - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let q = supabase
        .from("credit_mutations")
        .select(
          `
          id, tenant_id, deposit_id, kind,
          amount, credit_before, credit_after,
          txn_at, performed_at, description, created_by,
          deposits:deposits(username_snapshot)
        `,
          { count: "exact" }
        )
        .order("id", { ascending: false });

      if (fId.trim()) {
        const asNum = Number(fId.trim());
        if (!Number.isNaN(asNum)) q = q.eq("id", asNum);
      }

      // filter waktu berdasarkan performed_at (waktu click/real)
      if (fStartClick) q = q.gte("performed_at", startOfDayJakartaISO(fStartClick));
      if (fFinishClick) q = q.lte("performed_at", endOfDayJakartaISO(fFinishClick));

      // kategori
      if (catToKinds) q = q.in("kind", catToKinds as any);

      // desc
      if (fDesc.trim()) q = q.ilike("description", `%${fDesc.trim()}%`);

      const { data, error, count } = await q.range(from, to);
      if (error) {
        alert(error.message);
        setRows([]);
        setTotal(0);
        setPage(1);
        return;
      }
      setRows((data as CreditMutationRow[]) ?? []);
      setTotal(count ?? 0);
      setPage(pageToLoad);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // initial load (default filter = hari ini)
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = (e?: React.FormEvent) => {
    e?.preventDefault();
    load(1);
  };

  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="space-y-3">
      <div className="rounded border bg-white p-3 text-sm">
        <b>Credit Mutations.</b> Balance sekarang {formatAmount(tenantCredit)}
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1100px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* Baris FILTERS di atas header kolom */}
            <tr className="filters">
              {/* Cari ID */}
              <th className="w-24">
                <input
                  placeholder="Cari ID"
                  value={fId}
                  onChange={(e) => setFId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              {/* Waktu Click: Start & Finish (default hari ini) */}
              <th>
                <div className="flex flex-col gap-1">
                  <input
                    type="date"
                    value={fStartClick}
                    onChange={(e) => setFStartClick(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Start (Click)"
                  />
                  <input
                    type="date"
                    value={fFinishClick}
                    onChange={(e) => setFFinishClick(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Finish (Click)"
                  />
                </div>
              </th>
              {/* Waktu dipilih kolom tidak punya filter, hanya tampil beda waktu */}
              <th></th>
              {/* Cat */}
              <th>
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
              {/* Desc */}
              <th>
                <input
                  placeholder="Desc"
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              {/* Amount / Start / Finish / Creator: no filter */}
              <th></th>
              <th></th>
              <th></th>
              <th className="whitespace-nowrap">
                <button
                  onClick={applyFilters}
                  className="rounded bg-blue-600 text-white px-3 py-1"
                >
                  submit
                </button>
              </th>
            </tr>

            <tr>
              <th className="text-left w-24">ID</th>
              <th className="text-left w-52">Waktu Click</th>
              <th className="text-left w-52">Waktu dipilih</th>
              <th className="text-left w-20">Cat</th>
              <th className="text-left min-w-[260px]">Desc</th>
              <th className="text-right w-28">Amount</th>
              <th className="text-right w-28">Start</th>
              <th className="text-right w-28">Finish</th>
              <th className="text-left w-48">Creator</th>
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
                  <td>{catLabel(r.kind)}</td>
                  <td className="whitespace-normal break-words">
                    {r.description ??
                      (r.kind === "deposit" && r.deposits?.username_snapshot
                        ? `Depo dari ${r.deposits.username_snapshot}`
                        : "-")}
                  </td>
                  <td className="text-right">{formatAmount(r.amount)}</td>
                  <td className="text-right">{formatAmount(r.credit_before)}</td>
                  <td className="text-right">{formatAmount(r.credit_after)}</td>
                  <td className="whitespace-normal break-words">
                    {r.created_by ?? "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button
            onClick={() => {
              if (page <= 1) return;
              setPage(1);
              load(1);
            }}
            disabled={page <= 1}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            First
          </button>
          <button
            onClick={() => {
              if (page <= 1) return;
              load(page - 1);
            }}
            disabled={page <= 1}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 rounded border bg-white">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => {
              if (page >= totalPages) return;
              load(page + 1);
            }}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={() => {
              if (page >= totalPages) return;
              load(totalPages);
            }}
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
