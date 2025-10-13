"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/** ================= Helpers ================= **/
const PAGE_SIZE = 50;

function todayJakartaYmd() {
  // yyyy-mm-dd in Asia/Jakarta
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
function startOfDayJakartaISO(ymd: string) {
  return new Date(`${ymd}T00:00:00+07:00`).toISOString();
}
function endOfDayJakartaISO(ymd: string) {
  return new Date(`${ymd}T23:59:59.999+07:00`).toISOString();
}

// Map enum 'kind' -> bucket Cat (DP/WD/ADJ/TOPUP)
function catFromKind(kind: string | null | undefined): "DP" | "WD" | "ADJ" | "TOPUP" | "-" {
  const k = (kind ?? "").toUpperCase();
  if (k === "DEPOSIT" || k === "REVERSAL_DEPOSIT") return "DP";
  if (k === "WITHDRAWAL" || k === "REVERSAL_WITHDRAWAL") return "WD";
  if (k === "CREDIT_ADJUSTMENT") return "ADJ";     // untuk ke depan
  if (k === "CREDIT_TOPUP") return "TOPUP";        // untuk ke depan
  return "-";
}
function kindsForCat(cat: "ALL" | "DP" | "WD" | "ADJ" | "TOPUP") {
  switch (cat) {
    case "DP":
      return ["DEPOSIT", "REVERSAL_DEPOSIT", "deposit", "reversal_deposit"];
    case "WD":
      return ["WITHDRAWAL", "REVERSAL_WITHDRAWAL", "withdrawal", "reversal_withdrawal"];
    case "ADJ":
      return ["CREDIT_ADJUSTMENT", "credit_adjustment"];
    case "TOPUP":
      return ["CREDIT_TOPUP", "credit_topup"];
    default:
      return [];
  }
}

/** ================= Types (mengikuti skema kamu) ================= **/
type CreditMutation = {
  id: number;
  tenant_id: string;
  deposit_id: number | null;
  kind: string;
  amount: number;
  credit_before: number;
  credit_after: number;
  txn_at: string;        // waktu dipilih (backdate)
  performed_at: string;  // waktu klik (real)
  description: string | null;
  created_by: string | null;
};

type DepositLite = {
  id: number;
  username: string | null;       // ambil dari deposits.username
  opened_at: string | null;      // waktu modal dibuka (opsional)
  txn_at: string;                // waktu dipilih/backdate
  performed_at: string;          // waktu klik (real)
};

/** ================= Komponen ================= **/
export default function CreditMutationsTable() {
  const supabase = supabaseBrowser();

  // ringkasan balance tenant
  const [tenantCredit, setTenantCredit] = useState<number>(0);

  // tabel
  const [rows, setRows] = useState<CreditMutation[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // filters (default: hari ini, filter waktu = performed_at)
  const [fStart, setFStart] = useState<string>(todayJakartaYmd());
  const [fFinish, setFFinish] = useState<string>(todayJakartaYmd());
  const [fCat, setFCat] = useState<"ALL" | "DP" | "WD" | "ADJ" | "TOPUP">("ALL");
  const [fDesc, setFDesc] = useState<string>("");
  const [fId, setFId] = useState<string>("");

  // cache join deposits & profiles
  const [depositMap, setDepositMap] = useState<Record<number, DepositLite>>({});
  const [creatorNameMap, setCreatorNameMap] = useState<Record<string, string>>({});

  // ----- load tenant balance -----
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
      if (prof?.tenant_id) {
        const { data: tenant } = await supabase
          .from("tenants")
          .select("credit_balance")
          .eq("id", prof.tenant_id)
          .single();
        setTenantCredit(tenant?.credit_balance ?? 0);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- build & run list query -----
  const buildQuery = () => {
    let q = supabase
      .from("credit_mutations")
      .select("*", { count: "exact" })
      .order("performed_at", { ascending: false });

    if (fId.trim()) {
      const n = Number(fId.trim());
      if (!Number.isNaN(n)) q = q.eq("id", n);
    }
    if (fStart) q = q.gte("performed_at", startOfDayJakartaISO(fStart));
    if (fFinish) q = q.lte("performed_at", endOfDayJakartaISO(fFinish));

    if (fDesc.trim()) q = q.ilike("description", `%${fDesc.trim()}%`);

    if (fCat !== "ALL") {
      const kinds = kindsForCat(fCat);
      if (kinds.length > 0) q = q.in("kind", kinds as any);
    }

    return q;
  };

  const load = async (pageToLoad = page) => {
    setLoading(true);
    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error, count } = await buildQuery().range(from, to);
    if (error) {
      setLoading(false);
      alert(error.message);
      return;
    }
    const list = (data as CreditMutation[]) ?? [];
    setRows(list);
    setTotal(count ?? 0);
    setPage(pageToLoad);

    // Join deposits (sekali untuk semua deposit_id yang ada)
    const depIds = Array.from(new Set(list.map((r) => r.deposit_id).filter((v): v is number => !!v)));
    if (depIds.length > 0) {
      const { data: deps } = await supabase
        .from("deposits")
        .select("id, username, opened_at, txn_at, performed_at")
        .in("id", depIds);
      const map: Record<number, DepositLite> = {};
      for (const d of (deps as any[] | null) ?? []) {
        map[d.id] = {
          id: d.id,
          username: d.username ?? null,
          opened_at: d.opened_at ?? null,
          txn_at: d.txn_at,
          performed_at: d.performed_at,
        };
      }
      setDepositMap(map);
    } else {
      setDepositMap({});
    }

    // Join profiles -> full_name
    const creatIds = Array.from(
      new Set(list.map((r) => r.created_by).filter((v): v is string => !!v))
    );
    if (creatIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", creatIds);
      const map: Record<string, string> = {};
      for (const p of (profs as any[] | null) ?? []) {
        map[p.user_id] = p.full_name;
      }
      setCreatorNameMap(map);
    } else {
      setCreatorNameMap({});
    }

    setLoading(false);
  };

  useEffect(() => {
    // default: load hari ini saat pertama kali buka
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters: React.FormEventHandler = (e) => {
    e.preventDefault();
    load(1);
  };

  // helper tampil deskripsi sesuai aturan kamu
  const renderDesc = (r: CreditMutation) => {
    const dep = r.deposit_id ? depositMap[r.deposit_id] : undefined;
    const username = dep?.username ?? "-";
    const kind = (r.kind || "").toUpperCase();

    if (kind === "DEPOSIT") return `Depo dari ${username}`;
    if (kind === "REVERSAL_DEPOSIT") {
      const t = dep?.performed_at
        ? new Date(dep.performed_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
        : "-";
      return `Reversal Depo dari ${username} (${t})`;
    }
    if (kind === "WITHDRAWAL") return `WD ke ${username}`;
    if (kind === "REVERSAL_WITHDRAWAL") {
      const t = dep?.performed_at
        ? new Date(dep.performed_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
        : "-";
      return `Reversal WD dari ${username} (${t})`;
    }
    // fallback gunakan description dari DB
    return r.description ?? "-";
  };

  const canPrev = page > 1;
  const canNext = page < totalPages;

  const pageLabel = useMemo(() => `Page ${page} / ${totalPages}`, [page, totalPages]);

  return (
    <div className="space-y-3">
      {/* header balance */}
      <div className="rounded border bg-white p-3 text-sm">
        <b>Credit Mutations.</b> Balance sekarang {formatAmount(tenantCredit)}
      </div>

      <div className="overflow-auto rounded border bg-white">
        <form onSubmit={applyFilters}>
          <table className="table-grid min-w-[1100px]" style={{ borderCollapse: "collapse" }}>
            <thead>
              {/* filter bar */}
              <tr className="filters">
                <th className="w-20">
                  <input
                    placeholder="Cari ID"
                    value={fId}
                    onChange={(e) => setFId(e.target.value)}
                    className="w-full border rounded px-2 py-1"
                  />
                </th>
                <th className="w-64">
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
                <th className="w-32" />
                <th className="w-40">
                  <select
                    value={fCat}
                    onChange={(e) => setFCat(e.target.value as any)}
                    className="border rounded px-2 py-1 w-full"
                  >
                    <option value="ALL">ALL</option>
                    <option value="DP">DP</option>
                    <option value="WD">WD</option>
                    <option value="ADJ">Adjustment</option>
                    <option value="TOPUP">Topup</option>
                  </select>
                </th>
                <th className="w-[320px]">
                  <input
                    placeholder="Desc"
                    value={fDesc}
                    onChange={(e) => setFDesc(e.target.value)}
                    className="w-full border rounded px-2 py-1"
                  />
                </th>
                <th />
                <th />
                <th />
                <th className="whitespace-nowrap">
                  <button type="submit" className="rounded bg-blue-600 text-white px-3 py-1">
                    submit
                  </button>
                </th>
              </tr>

              {/* header */}
              <tr>
                <th className="text-left w-20">ID</th>
                <th className="text-left w-64">Waktu Click</th>
                <th className="text-left w-50">Waktu dipilih</th>
                <th className="text-left w-28">Cat</th>
                <th className="text-left min-w-[320px]">Desc</th>
                <th className="text-left w-28">Amount</th>
                <th className="text-left w-33">Start</th>
                <th className="text-left w-33">Finish</th>
                <th className="text-left w-30">Creator</th>
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
                  const cat = catFromKind(r.kind);
                  const creator = r.created_by
                    ? (creatorNameMap[r.created_by] ?? r.created_by)
                    : "-";
                  return (
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
                      <td>{cat}</td>
                      <td className="whitespace-normal break-words">{renderDesc(r)}</td>
                      <td>{formatAmount(r.amount)}</td>
                      <td>{formatAmount(r.credit_before)}</td>
                      <td>{formatAmount(r.credit_after)}</td>
                      <td>{creator}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </form>
      </div>

      {/* pagination */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button
            onClick={() => canPrev && load(1)}
            disabled={!canPrev}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            First
          </button>
          <button
            onClick={() => canPrev && load(page - 1)}
            disabled={!canPrev}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 rounded border bg-white">{pageLabel}</span>
          <button
            onClick={() => canNext && load(page + 1)}
            disabled={!canNext}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={() => canNext && load(totalPages)}
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
