"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/* ============ helpers angka (positif saja) ============ */
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
function toNumber(input: string) {
  let c = (input || "0").replace(/,/g, "");
  if (c.endsWith(".")) c = c.slice(0, -1);
  const n = Number(c);
  return isNaN(n) ? 0 : n;
}
function nowLocalDatetimeValue() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ============ types ============ */
type Row = {
  id: number;
  amount: number;
  description: string | null;
  txn_at: string;
  performed_at: string;
  created_by: string | null;
};
type Creator = { user_id: string; full_name: string | null };

/* ============ komponen ============ */
export default function CreditTopup() {
  const supabase = supabaseBrowser();

  // tenant
  const [tenantId, setTenantId] = useState<string>("");
  const [tenantName, setTenantName] = useState<string>("");
  const [tenantCredit, setTenantCredit] = useState<number>(0);

  // table & paging
  const PAGE_SIZE = 50;
  const [loading, setLoading] = useState<boolean>(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [creatorMap, setCreatorMap] = useState<Record<string, string>>({});

  // modal
  const [showNew, setShowNew] = useState(false);
  const [amountStr, setAmountStr] = useState("0.00");
  const [txnAt, setTxnAt] = useState(nowLocalDatetimeValue());
  const [desc, setDesc] = useState("");
  const amountRef = useRef<HTMLInputElement | null>(null);

  // bootstrap tenant info
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("user_id", user?.id).single();
      const tid = prof?.tenant_id ?? "";
      setTenantId(tid);
      if (tid) {
        const { data: t } = await supabase.from("tenants").select("name, credit_balance").eq("id", tid).single();
        setTenantName(t?.name ?? "");
        setTenantCredit(t?.credit_balance ?? 0);
      }
    })();
  }, [supabase]);

  // ESC close modal (meniru Banks) :contentReference[oaicite:3]{index=3}
  useEffect(() => {
    if (!showNew) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowNew(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showNew]);

  // list loader
  const load = async (pageToLoad = page) => {
    setLoading(true);
    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error, count } = await supabase
      .from("credit_mutations")
      .select("id, amount, description, txn_at, performed_at, created_by", { count: "exact" })
      .eq("kind", "CREDIT_TOPUP")
      .order("performed_at", { ascending: false })
      .range(from, to);

    if (error) { setLoading(false); alert(error.message); return; }

    const list = (data as Row[]) ?? [];
    setRows(list);
    setTotal(count ?? 0);
    setPage(pageToLoad);

    const ids = Array.from(new Set(list.map(r => r.created_by).filter(Boolean))) as string[];
    if (ids.length > 0) {
      const { data: profs } = await supabase.from("profiles").select("user_id, full_name").in("user_id", ids);
      const m: Record<string, string> = {};
      for (const p of (profs as Creator[] | null) ?? []) m[p.user_id] = p.full_name || p.user_id;
      setCreatorMap(m);
    } else setCreatorMap({});

    setLoading(false);
  };
  useEffect(() => { load(1); /* default load */ }, /* eslint-disable-line */[]);

  // submit topup
  const submitNew = async () => {
    const amt = toNumber(amountStr);
    if (!(amt > 0)) { alert("Amount harus > 0"); amountRef.current?.focus(); return; }

    const { error } = await supabase.rpc("perform_credit_topup", {
      p_amount: amt,
      p_txn_at_final: new Date(txnAt).toISOString(),
      p_description: desc || null,
    });
    if (error) { alert(error.message); return; }

    setShowNew(false);
    setAmountStr("0.00"); setTxnAt(nowLocalDatetimeValue()); setDesc("");

    // refresh header & list
    const { data: t } = await supabase.from("tenants").select("credit_balance").eq("id", tenantId).single();
    setTenantCredit(t?.credit_balance ?? tenantCredit);
    await load(1);
  };

  return (
    <div className="space-y-3">
      <div className="rounded border bg-white p-3 text-sm">
        <b>Credit Topup — {tenantName}</b>
        <span className="ml-2">| Credit Balance: {formatAmount(tenantCredit)}</span>
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[900px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th colSpan={5} className="text-right p-2">
                <button
                  type="button"
                  onClick={() => { setShowNew(true); setAmountStr("0.00"); setTxnAt(nowLocalDatetimeValue()); setDesc(""); setTimeout(()=>amountRef.current?.select(),0); }}
                  className="rounded bg-blue-600 text-white px-3 py-1"
                >
                  New Credit Topup
                </button>
              </th>
            </tr>
            <tr>
              <th className="text-left w-20">ID</th>
              <th className="text-left w-32">Amount</th>
              <th className="text-left min-w-[260px]">Description</th>
              <th className="text-left w-44">Tgl</th>
              <th className="text-left w-36">By</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5}>No data</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{formatAmount(r.amount)}</td>
                <td className="whitespace-normal break-words">{r.description ?? "-"}</td>
                <td>{new Date(r.txn_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                <td>{r.created_by ? (creatorMap[r.created_by] ?? r.created_by) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button onClick={() => page>1 && load(1)} disabled={page<=1} className="px-3 py-1 rounded border bg-white disabled:opacity-50">First</button>
          <button onClick={() => page>1 && load(page-1)} disabled={page<=1} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Previous</button>
          <span className="px-3 py-1 rounded border bg-white">Page {page} / {totalPages}</span>
          <button onClick={() => page<totalPages && load(page+1)} disabled={page>=totalPages} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Next</button>
          <button onClick={() => page<totalPages && load(totalPages)} disabled={page>=totalPages} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Last</button>
        </nav>
      </div>

      {/* Modal New Credit Topup */}
      {showNew && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e)=>{ if (e.currentTarget === e.target) setShowNew(false); }}
        >
          <form
            onSubmit={(e)=>{ e.preventDefault(); submitNew(); }}
            className="bg-white rounded border w-full max-w-xl mt-10"
          >
            <div className="p-4 border-b font-semibold">New Credit Topup — {tenantName}</div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Amount</label>
                <input
                  ref={amountRef}
                  className="border rounded px-3 py-2 w-full"
                  value={amountStr}
                  onFocus={(e)=>e.currentTarget.select()}
                  onChange={(e)=>{
                    const f = formatWithGroupingLive(e.target.value);
                    setAmountStr(f);
                    setTimeout(()=>{ const el=amountRef.current; if(el){ const L=el.value.length; el.setSelectionRange(L,L); } },0);
                  }}
                  onBlur={()=>{
                    const n = toNumber(amountStr);
                    setAmountStr(new Intl.NumberFormat("en-US",{ minimumFractionDigits:2, maximumFractionDigits:2 }).format(n));
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
