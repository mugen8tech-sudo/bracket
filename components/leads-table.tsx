"use client";

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Lead = {
  id: number;
  name: string;
  bank: string | null;
  bank_name: string | null;
  bank_no: string | null;
  phone_number: string | null; // Whatsapp
  telp_invalid: boolean;
  username: string | null;
  registration_date: string;
};

export default function LeadsTable() {
  const supabase = supabaseBrowser();

  // data
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  // ===== FILTER per kolom (baris atas header) =====
  const [fId, setFId] = useState<string>("");
  const [fName, setFName] = useState<string>("");
  const [fBank, setFBank] = useState<string>("");             // text
  const [fBankName, setFBankName] = useState<string>("");
  const [fBankNo, setFBankNo] = useState<string>("");
  const [fWhatsapp, setFWhatsapp] = useState<string>("");     // ganti Telp Invalid? -> Whatsapp
  const [fUsername, setFUsername] = useState<string>("");
  const [fStart, setFStart] = useState<string>("");           // yyyy-mm-dd (Asia/Jakarta)
  const [fFinish, setFFinish] = useState<string>("");         // yyyy-mm-dd

  // Helper: konversi tanggal lokal Jakarta ke rentang ISO UTC untuk query
  const startIsoJakarta = (d: string) =>
    new Date(`${d}T00:00:00+07:00`).toISOString();
  const endIsoJakarta = (d: string) =>
    new Date(`${d}T23:59:59.999+07:00`).toISOString();

  const load = async () => {
    setLoading(true);
    let qy = supabase.from("leads").select("*")
      .order("registration_date", { ascending: false })
      .limit(500);

    // AND chaining untuk setiap filter yang terisi
    if (fId.trim()) {
      const asNum = Number(fId.trim());
      if (!Number.isNaN(asNum)) qy = qy.eq("id", asNum);
      // jika bukan angka, abaikan (id numeric)
    }
    if (fName.trim())       qy = qy.ilike("name", `%${fName.trim()}%`);
    if (fBank.trim())       qy = qy.ilike("bank", `%${fBank.trim()}%`);
    if (fBankName.trim())   qy = qy.ilike("bank_name", `%${fBankName.trim()}%`);
    if (fBankNo.trim())     qy = qy.ilike("bank_no", `%${fBankNo.trim()}%`);
    if (fWhatsapp.trim())   qy = qy.ilike("phone_number", `%${fWhatsapp.trim()}%`);
    if (fUsername.trim())   qy = qy.ilike("username", `%${fUsername.trim()}%`);
    if (fStart)             qy = qy.gte("registration_date", startIsoJakarta(fStart));
    if (fFinish)            qy = qy.lte("registration_date", endIsoJakarta(fFinish));

    const { data, error } = await qy;
    setLoading(false);
    if (error) alert(error.message);
    else setRows((data as Lead[]) ?? []);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const applyFilters = (e?: React.FormEvent) => { e?.preventDefault(); load(); };
  const resetFilters  = () => {
    setFId(""); setFName(""); setFBank(""); setFBankName(""); setFBankNo("");
    setFWhatsapp(""); setFUsername(""); setFStart(""); setFFinish("");
    load();
  };

  // ====== Modal ======
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [form, setForm] = useState<Partial<Lead>>({});

  const openNew = () => {
    setEditing(null);
    setForm({ username: "", name: "", bank_name: "", bank: "", bank_no: "", phone_number: "" });
    setShowForm(true);
  };
  const openEdit = (r: Lead) => {
    setEditing(r);
    setForm(r);
    setShowForm(true);
  };
  const closeModal = useCallback(() => setShowForm(false), []);

  // ESC to close
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeModal(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showForm, closeModal]);

  const save = async () => {
    // tenant_id dari profile pengguna
    const { data: { user } } = await supabase.auth.getUser();
    const { data: prof, error: eProf } = await supabase
      .from("profiles").select("tenant_id").eq("user_id", user?.id).single();
    if (eProf) { alert(eProf.message); return; }

    const payload: any = {
      username: form.username ?? null,
      name: form.name,
      bank_name: form.bank_name ?? null,
      bank: form.bank ?? null,
      bank_no: form.bank_no ?? null,
      phone_number: form.phone_number ?? null, // Whatsapp
      tenant_id: prof?.tenant_id
      // registration_date -> default now()
      // telp_invalid -> default false
    };

    let error;
    if (editing) {
      const resp = await supabase.from("leads").update(payload).eq("id", editing.id).select().single();
      error = resp.error;
    } else {
      const resp = await supabase.from("leads").insert(payload).select().single();
      error = resp.error;
    }
    if (error) return alert(error.message);
    setShowForm(false);
    await load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button type="button" onClick={openNew} className="rounded bg-green-600 text-white px-4 py-2">
          New Lead
        </button>
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1200px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* ===== Row FILTERS (di atas header) ===== */}
            <tr className="filters">
              <th>
                <input
                  placeholder="ID"
                  value={fId}
                  onChange={(e)=>setFId(e.target.value)}
                  onKeyDown={(e)=>e.key==='Enter' && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <input
                  placeholder="name"
                  value={fName}
                  onChange={(e)=>setFName(e.target.value)}
                  onKeyDown={(e)=>e.key==='Enter' && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <input
                  placeholder="bank"
                  value={fBank}
                  onChange={(e)=>setFBank(e.target.value)}
                  onKeyDown={(e)=>e.key==='Enter' && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <input
                  placeholder="bank name"
                  value={fBankName}
                  onChange={(e)=>setFBankName(e.target.value)}
                  onKeyDown={(e)=>e.key==='Enter' && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <input
                  placeholder="bank no"
                  value={fBankNo}
                  onChange={(e)=>setFBankNo(e.target.value)}
                  onKeyDown={(e)=>e.key==='Enter' && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <input
                  placeholder="whatsapp"
                  value={fWhatsapp}
                  onChange={(e)=>setFWhatsapp(e.target.value)}
                  onKeyDown={(e)=>e.key==='Enter' && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>{/* Telp Invalid? -> tidak ada filter, biarkan kosong */}</th>
              <th>
                <input
                  placeholder="username"
                  value={fUsername}
                  onChange={(e)=>setFUsername(e.target.value)}
                  onKeyDown={(e)=>e.key==='Enter' && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <div className="flex flex-col gap-1">
                  <input
                    type="date"
                    value={fStart}
                    onChange={(e)=>setFStart(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Start date"
                  />
                  <input
                    type="date"
                    value={fFinish}
                    onChange={(e)=>setFFinish(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Finish date"
                  />
                </div>
              </th>
              <th className="whitespace-nowrap">
                <div className="flex gap-2">
                  <button onClick={applyFilters} className="rounded bg-blue-600 text-white px-3 py-1">Submit</button>
                  <button onClick={resetFilters} className="rounded bg-gray-100 px-3 py-1">Reset</button>
                </div>
              </th>
            </tr>

            {/* ===== Row HEADER ===== */}
            <tr>
              <th className="text-left">ID</th>
              <th className="text-left">Name</th>
              <th className="text-left">Bank</th>
              <th className="text-left">Bank Name</th>
              <th className="text-left">Bank No</th>
              <th className="text-left">Whatsapp</th>
              <th className="text-left">Telp Invalid?</th>
              <th className="text-left">Username</th>
              <th className="text-left">Registration Date</th>
              <th className="text-left">Action</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr><td colSpan={10}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10}>No data</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td>{r.id}</td>
                <td>{r.name}</td>
                <td>{r.bank ?? "-"}</td>
                <td>{r.bank_name ?? "-"}</td>
                <td>{r.bank_no ?? "-"}</td>
                <td>{r.phone_number ?? "-"}</td>
                <td>{r.telp_invalid ? "YES" : "NO"}</td>
                <td>{r.username ?? "-"}</td>
                <td>{new Date(r.registration_date).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                <td>
                  <button onClick={()=>openEdit(r)} className="rounded bg-gray-100 px-3 py-1">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ===== Modal ===== */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => { if (e.currentTarget === e.target) closeModal(); }}
        >
          {/* posisi lebih ke atas: mt-10 */}
          <div className="bg-white rounded border w-full max-w-2xl mt-10">
            <div className="p-4 border-b flex justify-between items-center">
              <div className="font-semibold">{editing ? "Edit Lead" : "New Lead"}</div>
              <button onClick={closeModal} className="text-sm">✕</button>
            </div>

            <div className="p-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1">Username</label>
                <input className="border rounded px-3 py-2 w-full"
                  value={form.username ?? ""} onChange={e=>setForm(p=>({...p, username:e.target.value}))}/>
              </div>
              <div>
                <label className="block text-xs mb-1">Name</label>
                <input className="border rounded px-3 py-2 w-full"
                  value={form.name ?? ""} onChange={e=>setForm(p=>({...p, name:e.target.value}))}/>
              </div>
              <div>
                <label className="block text-xs mb-1">Bank Name</label>
                <input className="border rounded px-3 py-2 w-full"
                  value={form.bank_name ?? ""} onChange={e=>setForm(p=>({...p, bank_name:e.target.value}))}/>
              </div>
              <div>
                <label className="block text-xs mb-1">Bank</label>
                <select className="border rounded px-3 py-2 w-full"
                  value={form.bank ?? ""} onChange={e=>setForm(p=>({...p, bank:e.target.value}))}>
                  <option value="">Pilih bank</option>
                  {["BCA","BRI","BNI","MANDIRI","BSI","CIMB","PERMATA","SEABANK","JAGO","DANA","OVO","GOPAY","SHOPEEPAY","LINKAJA","SAKUKU","OTHER"]
                    .map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1">Bank No</label>
                <input className="border rounded px-3 py-2 w-full"
                  value={form.bank_no ?? ""} onChange={e=>setForm(p=>({...p, bank_no:e.target.value}))}/>
              </div>
              <div>
                <label className="block text-xs mb-1">Whatsapp</label>
                <input className="border rounded px-3 py-2 w-full" placeholder="08xxxxxxxxxx"
                  value={form.phone_number ?? ""} onChange={e=>setForm(p=>({...p, phone_number:e.target.value}))}/>
              </div>
            </div>

            <div className="border-t p-4 flex justify-end gap-2">
              <button onClick={closeModal} className="rounded px-4 py-2 bg-gray-100">Cancel</button>
              <button onClick={save} className="rounded px-4 py-2 bg-blue-600 text-white">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
