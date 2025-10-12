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

const bankOptions = [
  "BCA","BRI","BNI","MANDIRI","BSI","CIMB","PERMATA",
  "SEABANK","JAGO","DANA","OVO","GOPAY","SHOPEEPAY",
  "LINKAJA","SAKUKU","OTHER"
];

export default function LeadsTable() {
  const supabase = supabaseBrowser();
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [q, setQ] = useState("");
  const [bank, setBank] = useState("ALL");
  const [invalid, setInvalid] = useState<"ALL"|"YES"|"NO">("ALL");
  const [start, setStart] = useState<string>("");
  const [finish, setFinish] = useState<string>("");

  // modal/form
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [form, setForm] = useState<Partial<Lead>>({});

  // Helper: konversi tanggal (YYYY-MM-DD) ke ISO range sesuai zona "Asia/Jakarta"
  const startIsoJakarta = (d: string) =>
    new Date(`${d}T00:00:00+07:00`).toISOString();
  const endIsoJakarta = (d: string) =>
    new Date(`${d}T23:59:59.999+07:00`).toISOString();

  const load = async () => {
    setLoading(true);
    let qy = supabase.from("leads").select("*")
      .order("registration_date", {ascending: false})
      .limit(500);

    if (bank && bank !== "ALL") qy = qy.eq("bank", bank);
    if (invalid === "YES") qy = qy.eq("telp_invalid", true);
    if (invalid === "NO")  qy = qy.eq("telp_invalid", false);
    if (start) qy = qy.gte("registration_date", startIsoJakarta(start));
    if (finish) qy = qy.lte("registration_date", endIsoJakarta(finish));
    if (q) {
      const like = `%${q}%`;
      qy = qy.or(`name.ilike.${like},username.ilike.${like},phone_number.ilike.${like},bank_name.ilike.${like},bank_no.ilike.${like}`);
    }

    const { data, error } = await qy;
    setLoading(false);
    if (error) {
      alert(error.message);
    } else {
      setRows((data as Lead[]) ?? []);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const onSubmitFilter = (e: React.FormEvent) => { e.preventDefault(); load(); };

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

  // ESC key to close
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showForm, closeModal]);

  const save = async () => {
    // tenant_id dari profile (untuk insert)
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
      // telp_invalid: default false di DB → tidak perlu dikirim
      // registration_date: default now() di DB (UTC) → tidak perlu dikirim
      tenant_id: prof?.tenant_id
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
    <div className="space-y-4">
      {/* Filter bar */}
      <form onSubmit={onSubmitFilter} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs mb-1">Search</label>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="name / username / whatsapp"
            className="border rounded px-3 py-2 w-64"/>
        </div>
        <div>
          <label className="block text-xs mb-1">Bank</label>
          <select value={bank} onChange={e=>setBank(e.target.value)} className="border rounded px-3 py-2">
            <option value="ALL">ALL</option>
            {bankOptions.map(b=><option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs mb-1">Telp Invalid?</label>
          <select value={invalid} onChange={e=>setInvalid(e.target.value as any)} className="border rounded px-3 py-2">
            <option value="ALL">ALL</option>
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </select>
        </div>
        <div>
          <label className="block text-xs mb-1">Start</label>
          <input type="date" value={start} onChange={e=>setStart(e.target.value)} className="border rounded px-3 py-2"/>
        </div>
        <div>
          <label className="block text-xs mb-1">Finish</label>
          <input type="date" value={finish} onChange={e=>setFinish(e.target.value)} className="border rounded px-3 py-2"/>
        </div>
        <button className="rounded bg-blue-600 text-white px-4 py-2">Submit</button>
        <div className="flex-1"></div>
        <button type="button" onClick={openNew} className="rounded bg-green-600 text-white px-4 py-2">New Lead</button>
      </form>

      {/* Tabel */}
      <div className="overflow-auto rounded border bg-white">
        <table className="min-w-[1200px] w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left p-2 w-20">ID</th>
              <th className="text-left p-2 w-56">Name</th>
              <th className="text-left p-2 w-32">Bank</th>
              <th className="text-left p-2 w-56">Bank Name</th>
              <th className="text-left p-2 w-48">Bank No</th>
              <th className="text-left p-2 w-44">Whatsapp</th>
              <th className="text-left p-2 w-32">Telp Invalid?</th>
              <th className="text-left p-2 w-40">Username</th>
              <th className="text-left p-2 w-48">Registration Date</th>
              <th className="text-left p-2 w-36">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-3" colSpan={10}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-3" colSpan={10}>No data</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-b hover:bg-gray-50">
                <td className="p-2">{r.id}</td>
                <td className="p-2">{r.name}</td>
                <td className="p-2">{r.bank ?? "-"}</td>
                <td className="p-2">{r.bank_name ?? "-"}</td>
                <td className="p-2">{r.bank_no ?? "-"}</td>
                <td className="p-2">{r.phone_number ?? "-"}</td>
                <td className="p-2">{r.telp_invalid ? "YES" : "NO"}</td>
                <td className="p-2">{r.username ?? "-"}</td>
                <td className="p-2">
                  {new Date(r.registration_date).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                </td>
                <td className="p-2">
                  <button onClick={()=>openEdit(r)} className="rounded bg-gray-100 px-3 py-1">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal Form */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) closeModal(); // klik area luar modal → close
          }}
        >
          <div className="bg-white rounded border w-full max-w-2xl">
            <div className="p-4 border-b flex justify-between items-center">
              <div className="font-semibold">{editing ? "Edit Lead" : "New Lead"}</div>
              <button onClick={closeModal} className="text-sm">✕</button>
            </div>

            {/* Susunan form sesuai instruksi */}
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
                  {bankOptions.map(b => <option key={b} value={b}>{b}</option>)}
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
