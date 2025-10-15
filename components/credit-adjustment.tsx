"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/** ==== helpers ==== */
const PAGE_SIZE = 50;

function normalizeMinus(raw: string) { return raw.replace(/\u2212|\u2013|\u2014/g, "-"); }
function formatWithGroupingLive(raw: string) {
  let cleaned = raw.replace(/,/g, "").replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
  let [intPart = "0", fracPartRaw] = cleaned.split(".");
  intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart === "") intPart = "0";
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (fracPartRaw !== undefined) {
    const frac = fracPartRaw.slice(0, 2);
    return fracPartRaw.length === 0 ? intGrouped + "." : intGrouped + "." + frac;
  }
  return intGrouped;
}
function formatWithGroupingLiveSigned(raw: string) {
  let s = normalizeMinus(raw.trim());
  const isNeg = s.startsWith("-") || s.endsWith("-");
  s = s.replace(/-/g, "");
  const grouped = formatWithGroupingLive(s);
  return (isNeg ? "-" : "") + grouped;
}
function toNumber(input: string) {
  let c = (input || "0").replace(/,/g, "");
  if (c.endsWith(".")) c = c.slice(0, -1);
  const n = Number(c);
  return isNaN(n) ? 0 : n;
}
function toNumberSigned(input: string) {
  let s = normalizeMinus(input.trim());
  const isNeg = s.startsWith("-") || s.endsWith("-");
  s = s.replace(/-/g, "");
  const n = toNumber(s);
  return isNeg ? -n : n;
}
function nowLocalDatetimeValue() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function todayJakartaYmd() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }); }
function startOfDayJakartaISO(ymd: string) { return new Date(`${ymd}T00:00:00+07:00`).toISOString(); }
function endOfDayJakartaISO(ymd: string) { return new Date(`${ymd}T23:59:59.999+07:00`).toISOString(); }

/** ==== types ==== */
type Row = {
  id: number;
  amount: number;
  description: string | null;
  is_bonus: boolean | null;
  txn_at: string;
  performed_at: string;
  created_by: string | null;
};

type Creator = { user_id: string; full_name: string | null };

export default function CreditAdjustment() {
  const supabase = supabaseBrowser();

  // tenant & balance
  const [tenantId, setTenantId] = useState<string>("");
  const [tenantName, setTenantName] = useState<string>("");
  const [tenantCredit, setTenantCredit] = useState<number>(0);

  // filters
  const [fIsBonus, setFIsBonus] = useState<"ALL" | "true" | "false">("ALL");
  const [fStart, setFStart] = useState<string>(todayJakartaYmd());
  const [fFinish, setFFinish] = useState<string>(todayJakartaYmd());

  // table state
  const [loading, setLoading] = useState<boolean>(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // join creator names
  const [creatorMap, setCreatorMap] = useState<Record<string, string>>({});

  // modal state
  const [showNew, setShowNew] = useState(false);
  const [amountStr, setAmountStr] = useState("0.00");
  const [txnAt, setTxnAt] = useState(nowLocalDatetimeValue());
  const [desc, setDesc] = useState("");
  const [isBonus, setIsBonus] = useState(true);
  const amountRef = useRef<HTMLInputElement | null>(null);

  /** bootstrap tenant */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("user_id", user.id).single();
      if (!prof?.tenant_id) return;
      setTenantId(prof.tenant_id);

      const { data: tenant } = await supabase.from("tenants").select("name, credit_balance").eq("id", prof.tenant_id).single();
      setTenantName(tenant?.name ?? "");
      setTenantCredit(tenant?.credit_balance ?? 0);
    })();
  }, [supabase]);

  // ESC → close New Credit Adjustment (meniru pola Banks)
  useEffect(() => {
    if (!showNew) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowNew(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showNew]);

  /** query */
  const buildQuery = () => {
    let q = supabase
      .from("credit_mutations")
      .select("id, amount, description, is_bonus, txn_at, performed_at, created_by", { count: "exact" })
      .eq("kind", "ADJUSTMENT_CREDIT")
      .order("performed_at", { ascending: false }); // filter tanggal berdasarkan Submitted

    // tanggal di atas kolom Submitted → gunakan performed_at
    if (fStart) q = q.gte("performed_at", startOfDayJakartaISO(fStart));
    if (fFinish) q = q.lte("performed_at", endOfDayJakartaISO(fFinish));

    if (fIsBonus === "true") q = q.eq("is_bonus", true);
    if (fIsBonus === "false") q = q.eq("is_bonus", false);

    return q;
  };

  const load = async (pageToLoad = page) => {
    setLoading(true);
    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error, count } = await buildQuery().range(from, to);
    if (error) { setLoading(false); alert(error.message); return; }

    const list = (data as Row[]) ?? [];
    setRows(list);
    setTotal(count ?? 0);
    setPage(pageToLoad);

    // join profiles (creator)
    const ids = Array.from(new Set(list.map((r) => r.created_by).filter(Boolean))) as string[];
    if (ids.length > 0) {
      const { data: profs } = await supabase.from("profiles").select("user_id, full_name").in("user_id", ids);
      const m: Record<string, string> = {};
      for (const p of (profs as Creator[] | null) ?? []) m[p.user_id] = p.full_name || p.user_id;
      setCreatorMap(m);
    } else {
      setCreatorMap({});
    }

    setLoading(false);
  };

  useEffect(() => { load(1); /* default hari ini */ }, /* eslint-disable-line */ []);

  const canPrev = page > 1;
  const canNext = page < totalPages;

  /** submit new */
  const submitNew = async () => {
    const delta = toNumberSigned(amountStr);
    if (delta === 0) { alert("Amount tidak boleh 0."); amountRef.current?.focus(); return; }

    const { error } = await supabase.rpc("perform_credit_adjustment", {
      p_amount_delta: delta,
      p_txn_at_final: new Date(txnAt).toISOString(),
      p_is_bonus: isBonus,
      p_description: desc || null,
    });
    if (error) { alert(error.message); return; }

    setShowNew(false);
    setAmountStr("0.00"); setTxnAt(nowLocalDatetimeValue()); setDesc(""); setIsBonus(true);

    const { data: tenant } = await supabase.from("tenants").select("credit_balance").eq("id", tenantId).single();
    setTenantCredit(tenant?.credit_balance ?? tenantCredit);
    await load(1);
  };

  const applyFilters: React.FormEventHandler = (e) => { e.preventDefault(); load(1); };

  return (
    <div className="space-y-3">
      {/* header saldo */}
      <div className="rounded border bg-white p-3 text-sm">
        <b>Credit Adjustments — {tenantName}</b>
        <span className="ml-2">| Credit: {formatAmount(tenantCredit)}</span>
      </div>

      <div className="overflow-auto rounded border bg-white">
        <form onSubmit={applyFilters}>
          <table className="table-grid min-w-[1100px]" style={{ borderCollapse: "collapse" }}>
            <thead>
              {/* row tombol New di atas tombol submit (pojok kanan atas) */}
              <tr>
                <th colSpan={7} className="text-right p-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNew(true);
                      setAmountStr("0.00");
                      setTxnAt(nowLocalDatetimeValue());
                      setDesc("");
                      setIsBonus(true);
                      setTimeout(() => amountRef.current?.select(), 0);
                    }}
                    className="rounded bg-blue-600 text-white px-3 py-1"
                  >
                    New Credit Adjustment
                  </button>
                </th>
              </tr>

              {/* filter bar */}
              <tr className="filters">
                <th /> {/* ID */}
                <th /> {/* Amount */}
                <th /> {/* Description */}
                <th className="w-28">
                  <select
                    value={fIsBonus}
                    onChange={(e) => setFIsBonus(e.target.value as any)}
                    className="border rounded px-2 py-1 w-full"
                    aria-label="Is Bonus"
                  >
                    <option value="ALL">All</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </th>
                <th /> {/* Tgl */}
                <th className="w-40">
                  <div className="flex flex-col gap-1">
                    <input
                      type="date"
                      value={fStart}
                      onChange={(e) => setFStart(e.target.value)}
                      className="border rounded px-2 py-1 w-full"
                      aria-label="Submitted Start"
                    />
                    <input
                      type="date"
                      value={fFinish}
                      onChange={(e) => setFFinish(e.target.value)}
                      className="border rounded px-2 py-1 w-full"
                      aria-label="Submitted Finish"
                    />
                  </div>
                </th>
                <th className="text-right pr-3">
                  <button className="rounded bg-blue-600 text-white px-3 py-1">submit</button>
                </th>
              </tr>

              {/* header kolom */}
              <tr>
                <th className="text-left w-20">ID</th>
                <th className="text-left w-28">Amount</th>
                <th className="text-left min-w-[260px]">Description</th>
                <th className="text-left w-20">Is Bonus</th>
                <th className="text-left w-42">Tgl</th>
                <th className="text-left w-42">Submitted</th>
                <th className="text-left w-36">By</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr><td colSpan={7}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7}>No data</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{formatAmount(r.amount)}</td>
                    <td className="whitespace-normal break-words">{r.description ?? "-"}</td>
                    <td>{String(!!r.is_bonus)}</td>
                    <td>{new Date(r.txn_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                    <td>{new Date(r.performed_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                    <td>{r.created_by ? (creatorMap[r.created_by] ?? r.created_by) : "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </form>
      </div>

      {/* Modal New Credit Adjustment */}
      {showNew && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => { if (e.currentTarget === e.target) setShowNew(false); }}
        >
          <form
            onSubmit={(e) => { e.preventDefault(); submitNew(); }}
            className="bg-white rounded border w-full max-w-xl mt-10"
          >
            <div className="p-4 border-b font-semibold">New Credit Adjustment — {tenantName}</div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Amount (+/−)</label>
                <input
                  ref={amountRef}
                  className="border rounded px-3 py-2 w-full"
                  value={amountStr}
                  onFocus={(e)=>e.currentTarget.select()}
                  onChange={(e)=>{
                    const f = formatWithGroupingLiveSigned(e.target.value);
                    setAmountStr(f);
                    setTimeout(() => { const el = amountRef.current; if (el) { const L = el.value.length; el.setSelectionRange(L, L); } }, 0);
                  }}
                  onBlur={()=>{
                    const n = toNumberSigned(amountStr);
                    setAmountStr(new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n));
                  }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Transaction Date</label>
                <input type="datetime-local" step="1" className="border rounded px-3 py-2 w-full" value={txnAt} onChange={(e)=>setTxnAt(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs mb-1">Description</label>
                <textarea rows={3} className="border rounded px-3 py-2 w-full" value={desc} onChange={(e)=>setDesc(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <input id="is_bonus" type="checkbox" checked={isBonus} onChange={(e)=>setIsBonus(e.target.checked)} />
                <label htmlFor="is_bonus">Bonus?</label>
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={()=>setShowNew(false)} className="rounded px-4 py-2 bg-gray-100">Close</button>
              <button type="submit" className="rounded px-4 py-2 bg-blue-600 text-white">Submit</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
