"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Lead = {
  id: number;
  name: string;
  bank: string | null;
  bank_name: string | null;
  bank_no: string | null;
  phone_number: string | null;
  telp_invalid: boolean;
  username: string | null;
  registration_date: string;
};

const banks = ["ALL","BCA","BRI","BNI","MANDIRI","DANA","OVO","GOPAY","SHOPEEPAY"];

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

  // form modal
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [form, setForm] = useState<Partial<Lead>>({});

  const load = async () => {
    setLoading(true);
    let qy = supabase.from("leads").select("*").order("registration_date", {ascending: false}).limit(500);

    if (bank && bank !== "ALL") qy = qy.eq("bank", bank);
    if (invalid === "YES") qy = qy.eq("telp_invalid", true);
    if (invalid === "NO")  qy = qy.eq("telp_invalid", false);
    if (start) qy = qy.gte("registration_date", new Date(start).toISOString());
    if (finish) {
      const end = new Date(finish);
      end.setDate(end.getDate()+1);
      qy = qy.lt("registration_date", end.toISOString());
    }
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

  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const onSubmitFilter = (e: React.FormEvent) => { e.preventDefault(); load(); };

  const openNew = () => { setEditing(null); setForm({ telp_invalid: false }); setShowForm(true); };
  const openEdit = (r: Lead) => { setEditing(r); setForm(r); setShowForm(true); };

  const save = async () => {
    // Ambil tenant_id user dari profiles agar insert/update lolos RLS
    const { data: { user } } = await supabase.auth.getUser();
    const { data: prof, error: eProf } = await supabase
      .from("profiles").select("tenant_id").eq("user_id", user?.id).single();
    if (eProf) { alert(eProf.message); return; }

    const payload: any = {
      name: form.name,
      bank: form.bank ?? null,
      bank_name: form.bank_name ?? null,
      bank_no: form.bank_no ?? null,
      phone_number: form.phone_number ?? null,
      telp_invalid: !!form.telp_invalid,
      username: form.username ?? null,
      registration_date: form.registration_date ?? new Date().toISOString(),
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
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="name / username / phone"
            className="border rounded px-3 py-2 w-64"/>
        </div>
        <div>
          <label className="block text-xs mb-1">Bank</label>
          <select value={bank} onChange={e=>setBank(e.target.value)} className="border rounded px-3 py-2">
            {banks.map(b=><option key={b} value={b}>{b}</option>)}
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
              <th className="text-left p-2 w-44">Phone Number</th>
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
                <td className="p-2">{new Date(r.registration_date).toLocaleString()}</td>
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
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
          <div className="bg-white rounded border w-full max-w-2xl">
            <div className="p-4 border-b flex justify-between items-center">
              <div className="font-semibold">{editing ? "Edit Lead" : "New Lead"}</div>
              <button onClick={()=>setShowForm(false)} className="text-sm">✕</button>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1">Name</label>
                <input className="border rounded px-3 py-2 w-full"
                  value={form.name ?? ""} onChange={e=>setForm(p=>({...p, name:e.target.value}))}/>
              </div>
              <div>
                <label className="block text-xs mb-1">Bank</label>
                <input className="border rounded px-3 py-2 w-full" placeholder="BCA/BRI/DANA…"
                  value={form.bank ?? ""} onChange={e=>setForm(p=>({...p, bank:e.target.value}))}/>
              </div>
              <div>
                <label className="block text-xs mb-1">Bank Name</label>
                <input className="border rounded px-3 py-2 w-full"
                  value={form.bank_name ?? ""} onChange={e=>setForm(p=>({...p, bank_name:e.target.value}))}/>
              </div>
              <div>
                <label className="block text-xs mb-1">Bank No</label>
                <input className="border rounded px-3 py-2 w-full"
                  value={form.bank_no ?? ""} onChange={e=>setForm(p=>({...p, bank_no:e.target.value}))}/>
              </div>
              <div>
                <label className="block text-xs mb-1">Phone Number</label>
                <input className="border rounded px-3 py-2 w-full"
                  value={form.phone_number ?? ""} onChange={e=>setForm(p=>({...p, phone_number:e.target.value}))}/>
              </div>
              <div className="flex items-center gap-2 mt-6">
                <input id="invalid" type="checkbox"
                  checked={!!form.telp_invalid}
                  onChange={e=>setForm(p=>({...p, telp_invalid:e.target.checked}))}/>
                <label htmlFor="invalid" className="text-sm">Telp Invalid?</label>
              </div>
              <div>
                <label className="block text-xs mb-1">Username</label>
                <input className="border rounded px-3 py-2 w-full"
                  value={form.username ?? ""} onChange={e=>setForm(p=>({...p, username:e.target.value}))}/>
              </div>
              <div>
                <label className="block text-xs mb-1">Registration Date</label>
                <input type="datetime-local" className="border rounded px-3 py-2 w-full"
                  value={form.registration_date
                    ? new Date(form.registration_date as any).toISOString().slice(0,16)
                    : new Date().toISOString().slice(0,16)}
                  onChange={e=>setForm(p=>({...p, registration_date:new Date(e.target.value).toISOString()}))}/>
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button onClick={()=>setShowForm(false)} className="rounded px-4 py-2 bg-gray-100">Cancel</button>
              <button onClick={save} className="rounded px-4 py-2 bg-blue-600 text-white">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
