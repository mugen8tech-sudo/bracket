"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/** ===== Types ===== */
type Bank = {
  id: number;
  tenant_id: string;
  bank_code: string;
  account_name: string;
  account_no: string;
  usage_type: "neutral" | "deposit" | "withdraw";
  is_active: boolean;
  is_pulsa: boolean;
  direct_fee_enabled: boolean;
  direct_fee_percent: number;
  balance: number;
  metadata: Record<string, any> | null;
};

const BANK_CODES = [
  "BCA","BRI","BNI","MANDIRI","BSI","CIMB","PERMATA",
  "SEABANK","JAGO","DANA","OVO","GOPAY","SHOPEEPAY",
  "LINKAJA","SAKUKU","OTHER"
];

const PURPOSE_OPTIONS: { label: "ALL" | "DP" | "WD"; value: Bank["usage_type"] }[] = [
  { label: "ALL", value: "neutral" },
  { label: "DP",  value: "deposit" },
  { label: "WD",  value: "withdraw" },
];

export default function BankManagement() {
  const supabase = supabaseBrowser();

  /** ===== Guard admin ===== */
  const [authorized, setAuthorized] = useState<"loading"|"ok"|"no">("loading");

  /** ===== Tenant (Website) ===== */
  const [tenantName, setTenantName] = useState<string>("");

  /** ===== Data banks ===== */
  const [rows, setRows] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);

  /** ===== Edit modal ===== */
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState<Bank | null>(null);
  const [eBankCode, setEBankCode] = useState<string>("");
  const [eAccName, setEAccName] = useState<string>("");
  const [eAccNo, setEAccNo] = useState<string>("");
  const [ePurpose, setEPurpose] = useState<Bank["usage_type"]>("neutral");
  const [eOrder, setEOrder] = useState<string>("0");
  const [eIsPulsa, setEIsPulsa] = useState<boolean>(false);
  const [eDirectFeeEnabled, setEDirectFeeEnabled] = useState<boolean>(false);
  const [eDirectFeePct, setEDirectFeePct] = useState<string>("0.00");
  const [saving, setSaving] = useState(false);

  /** ===== Toggle modal ===== */
  const [showToggle, setShowToggle] = useState(false);
  const [tBank, setTBank] = useState<Bank | null>(null);
  const [tReason, setTReason] = useState<string>("");

  /** ===== Load tenant name (meniru banks-table.tsx) ===== */
  async function loadTenantName(presetTenantId?: string | null) {
    let tenantId = presetTenantId ?? null;

    if (!tenantId) {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: prof } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", user?.id)
        .single();
      tenantId = prof?.tenant_id ?? null;
    }
    if (tenantId) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name")
        .eq("id", tenantId)
        .single();
      setTenantName(tenant?.name ?? "");
    } else {
      setTenantName("");
    }
  }

  /** ===== Load banks (tanpa join tenants) ===== */
  async function loadBanks() {
    setLoading(true);
    const { data, error } = await supabase
      .from("banks")
      .select("*")
      .order("id", { ascending: false });

    setLoading(false);
    if (error) { alert(error.message); return; }
    setRows((data as Bank[]) ?? []);
  }

  /** ===== Initial guard + loads ===== */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAuthorized("no"); return; }
      const { data: prof } = await supabase
        .from("profiles")
        .select("role, tenant_id")
        .eq("user_id", user.id)
        .single();
      if (!prof || prof.role !== "admin") { setAuthorized("no"); return; }
      setAuthorized("ok");

      await loadTenantName(prof?.tenant_id);
      await loadBanks();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ===== Sorting: display_order ASC, ACTIVE dulu, ID terbaru ===== */
  const rowsSorted = useMemo(() => {
    const order = (b: Bank) =>
      Number((b.metadata as any)?.display_order ?? Number.POSITIVE_INFINITY);
    return [...rows].sort((a, b) => {
      const ao = order(a), bo = order(b);
      if (ao !== bo) return ao - bo;
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return b.id - a.id;
    });
  }, [rows]);

  /** ===== Edit modal open/submit ===== */
  function openEdit(b: Bank) {
    setEditing(b);
    setEBankCode(b.bank_code);
    setEAccName(b.account_name);
    setEAccNo(b.account_no);
    setEPurpose(b.usage_type);
    setEOrder(String((b.metadata as any)?.display_order ?? 0));
    setEIsPulsa(b.is_pulsa);
    setEDirectFeeEnabled(b.direct_fee_enabled);
    setEDirectFeePct(
      new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        .format(b.direct_fee_percent ?? 0)
    );
    setShowEdit(true);
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;

    const pct = Number(String(eDirectFeePct).replace(/,/g, ""));
    if (eDirectFeeEnabled && (Number.isNaN(pct) || pct < 0 || pct > 100)) {
      alert("Persentase potongan harus 0–100");
      return;
    }
    const displayOrder = Number(eOrder || "0");
    const meta = { ...(editing.metadata ?? {}), display_order: displayOrder };

    setSaving(true);
    const { error } = await supabase
      .from("banks")
      .update({
        bank_code: eBankCode.trim(),
        account_name: eAccName.trim(),
        account_no: eAccNo.trim(),
        usage_type: ePurpose,
        is_pulsa: eIsPulsa,
        direct_fee_enabled: eDirectFeeEnabled,
        direct_fee_percent: eDirectFeeEnabled ? Math.round(pct * 100) / 100 : 0,
        metadata: meta,
      })
      .eq("id", editing.id);
    setSaving(false);

    if (error) { alert(error.message); return; }
    setShowEdit(false);
    setEditing(null);
    await loadBanks();
  }

  /** ===== Toggle modal open/submit ===== */
  function openToggle(b: Bank) {
    setTBank(b);
    setTReason("");
    setShowToggle(true);
  }
  async function submitToggle(e: React.FormEvent) {
    e.preventDefault();
    if (!tBank) return;

    const { data: { user } } = await supabase.auth.getUser();
    const meta = {
      ...(tBank.metadata ?? {}),
      last_status_change_reason: tReason || null,
      last_status_changed_at: new Date().toISOString(),
      last_status_changed_by: user?.id ?? null,
    };
    const { error } = await supabase
      .from("banks")
      .update({ is_active: !tBank.is_active, metadata: meta })
      .eq("id", tBank.id);

    if (error) { alert(error.message); return; }
    setShowToggle(false);
    setTBank(null);
    await loadBanks();
  }

  /** ===== Render guards ===== */
  if (authorized === "loading") return <div className="p-6">Loading…</div>;
  if (authorized === "no") {
    return (
      <div className="p-6">
        <div className="text-red-600 font-semibold mb-2">Unauthorized</div>
        <div>Halaman ini hanya untuk Admin.</div>
      </div>
    );
  }

  /** ===== UI ===== */
  return (
    <div className="space-y-4">
      <div className="overflow-auto rounded border bg-white">
        <table className="min-w-[1000px]" style={{ borderCollapse: "collapse" }}>
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2 border w-16">ID</th>
              <th className="text-left p-2 border min-w-[260px]">Bank</th>
              <th className="text-center p-2 border w-44">Website</th>
              <th className="text-center p-2 border w-48">Balance</th>
              <th className="text-center p-2 border w-32">Status</th>
              <th className="text-center p-2 border w-56">Manage</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-3" colSpan={6}>Loading…</td></tr>
            ) : rowsSorted.length === 0 ? (
              <tr><td className="p-3" colSpan={6}>No data</td></tr>
            ) : (
              rowsSorted.map((r) => {
                const bg =
                  r.usage_type === "deposit" ? "bg-green-200"
                  : r.usage_type === "withdraw" ? "bg-red-200"
                  : "bg-white";
                return (
                  <tr key={r.id} className={bg}>
                    <td className="p-2 border">{r.id}</td>
                    <td className="p-2 border">
                      <div className="font-semibold">[{r.bank_code}] {r.account_name}</div>
                      <div className="text-xs">{r.account_no}</div>
                    </td>
                    {/* Website mengikuti cara di banks-table.tsx */}
                    <td className="p-2 border text-center">{tenantName || "-"}</td>
                    <td className="p-2 border text-center">{formatAmount(r.balance)}</td>
                    <td className="p-2 border text-center">{r.is_active ? "ACTIVE" : "DELETED"}</td>
                    <td className="p-2 border">
                      <div className="flex items-center justify-center gap-2">
                        <button className="h-8 px-3 rounded bg-blue-600 text-white" onClick={() => openEdit(r)}>
                          Edit
                        </button>
                        <button className="h-8 px-3 rounded bg-blue-600 text-white" onClick={() => openToggle(r)}>
                          Toggle Status
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ===== Edit Modal ===== */}
      {showEdit && editing && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => { if (e.currentTarget === e.target) setShowEdit(false); }}
        >
          <form onSubmit={submitEdit} className="bg-white rounded border w-full max-w-2xl mt-10">
            <div className="p-4 border-b font-semibold">Edit Bank</div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Bank Provider</label>
                <select className="border rounded px-3 py-2 w-full"
                        value={eBankCode} onChange={(e)=>setEBankCode(e.target.value)} required>
                  {BANK_CODES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1">Nama rekening</label>
                <input className="border rounded px-3 py-2 w-full"
                       value={eAccName} onChange={(e)=>setEAccName(e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs mb-1">No rekening</label>
                <input className="border rounded px-3 py-2 w-full"
                       value={eAccNo} onChange={(e)=>setEAccNo(e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs mb-1">Purpose</label>
                <select className="border rounded px-3 py-2 w-full"
                        value={ePurpose} onChange={(e)=>setEPurpose(e.target.value as Bank["usage_type"])}>
                  {PURPOSE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1">Urutan</label>
                <input type="number" className="border rounded px-3 py-2 w-full"
                       value={eOrder} onChange={(e)=>setEOrder(e.target.value)} />
              </div>
              {/* Is Cash Basis? & Bank Tampung? — tidak dipakai */}
              <div className="flex items-center gap-2">
                <input id="e_pulsa" type="checkbox" checked={eIsPulsa} onChange={(e)=>setEIsPulsa(e.target.checked)} />
                <label htmlFor="e_pulsa">Is Pulsa?</label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input id="e_df" type="checkbox" checked={eDirectFeeEnabled} onChange={(e)=>setEDirectFeeEnabled(e.target.checked)} />
                  <label htmlFor="e_df">Potongan Langsung?</label>
                </div>
                {eDirectFeeEnabled && (
                  <div>
                    <label className="block text-xs mb-1">% potongan langsung</label>
                    <input type="number" min={0} max={100} step="0.01"
                           className="border rounded px-3 py-2 w-full"
                           value={eDirectFeePct} onChange={(e)=>setEDirectFeePct(e.target.value)} />
                  </div>
                )}
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={()=>setShowEdit(false)} className="rounded px-4 py-2 bg-gray-100">Close</button>
              <button disabled={saving} className="rounded px-4 py-2 bg-blue-600 text-white">
                {saving ? "Saving…" : "Submit"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Toggle Status Modal ===== */}
      {showToggle && tBank && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e)=>{ if(e.currentTarget===e.target) setShowToggle(false); }}
        >
          <form onSubmit={submitToggle} className="bg-white rounded border w-full max-w-2xl mt-10">
            <div className="p-4 border-b font-semibold">Konfirmasi Aktifasi bank</div>
            <div className="p-4 space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <div className="font-medium">Bank Provider</div>
                <div className="col-span-2">[{tBank.bank_code}]</div>
                <div className="font-medium">Account Name</div>
                <div className="col-span-2">{tBank.account_name}</div>
                <div className="font-medium">Account No</div>
                <div className="col-span-2">{tBank.account_no}</div>
                <div className="font-medium">Status</div>
                <div className="col-span-2">{tBank.is_active ? "ACTIVE" : "DELETED"}</div>
              </div>
              <div>
                <label className="block text-xs mb-1">Alasan</label>
                <input className="border rounded px-3 py-2 w-full"
                       value={tReason} onChange={(e)=>setTReason(e.target.value)}
                       placeholder="opsional" />
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={()=>setShowToggle(false)} className="rounded px-4 py-2 bg-gray-100">Close</button>
              <button className="rounded px-4 py-2 bg-blue-600 text-white">Submit</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
