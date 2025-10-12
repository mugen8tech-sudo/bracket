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
  telp_invalid: boolean;       // ada di DB, tidak ditampilkan
  username: string | null;
  registration_date: string;
};

const PAGE_SIZE = 25; // <= permintaan: khusus Leads 25 baris/halaman

export default function LeadsTable() {
  const supabase = supabaseBrowser();

  // ---------- data & pagination ----------
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0); // total rows (untuk hitung total pages)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ---------- FILTERS (baris di atas header) ----------
  const [fId, setFId] = useState<string>("");
  const [fName, setFName] = useState<string>("");
  const [fBank, setFBank] = useState<string>("");
  const [fBankName, setFBankName] = useState<string>("");
  const [fBankNo, setFBankNo] = useState<string>("");
  const [fWhatsapp, setFWhatsapp] = useState<string>("");
  const [fUsername, setFUsername] = useState<string>("");
  const [fStart, setFStart] = useState<string>("");   // yyyy-mm-dd (Asia/Jakarta)
  const [fFinish, setFFinish] = useState<string>("");  // yyyy-mm-dd

  // helper: konversi tanggal lokal Jakarta -> iso UTC range
  const startIsoJakarta = (d: string) =>
    new Date(`${d}T00:00:00+07:00`).toISOString();
  const endIsoJakarta = (d: string) =>
    new Date(`${d}T23:59:59.999+07:00`).toISOString();

  const buildQuery = () => {
    let q = supabase
      .from("leads")
      .select("*", { count: "exact" }) // butuh count untuk pagination
      .order("registration_date", { ascending: false });

    if (fId.trim()) {
      const asNum = Number(fId.trim());
      if (!Number.isNaN(asNum)) q = q.eq("id", asNum);
    }
    if (fName.trim()) q = q.ilike("name", `%${fName.trim()}%`);
    if (fBank.trim()) q = q.ilike("bank", `%${fBank.trim()}%`);
    if (fBankName.trim()) q = q.ilike("bank_name", `%${fBankName.trim()}%`);
    if (fBankNo.trim()) q = q.ilike("bank_no", `%${fBankNo.trim()}%`);
    if (fWhatsapp.trim()) q = q.ilike("phone_number", `%${fWhatsapp.trim()}%`);
    if (fUsername.trim()) q = q.ilike("username", `%${fUsername.trim()}%`);
    if (fStart) q = q.gte("registration_date", startIsoJakarta(fStart));
    if (fFinish) q = q.lte("registration_date", endIsoJakarta(fFinish));

    return q;
  };

  const load = async (pageToLoad = page) => {
    setLoading(true);
    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = buildQuery().range(from, to);

    const { data, error, count } = await q;
    setLoading(false);
    if (error) {
      alert(error.message);
    } else {
      setRows((data as Lead[]) ?? []);
      setTotal(count ?? 0);
      setPage(pageToLoad);
    }
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = (e?: React.FormEvent) => {
    e?.preventDefault();
    load(1); // setiap ganti filter -> mulai dari halaman 1
  };

  // ---------- pagination controls ----------
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const goFirst = () => canPrev && load(1);
  const goPrev = () => canPrev && load(page - 1);
  const goNext = () => canNext && load(page + 1);
  const goLast = () => canNext && load(totalPages);

  // buat daftar nomor halaman (dengan token "truncate" di tengah bila panjang)
  const getPageList = () => {
    const list: (number | "truncate")[] = [];
    if (totalPages <= 10) {
      for (let i = 1; i <= totalPages; i++) list.push(i);
      return list;
    }
    if (page <= 6) {
      list.push(1, 2, 3, 4, 5, 6, "truncate", totalPages);
      return list;
    }
    if (page >= totalPages - 5) {
      list.push(1, "truncate");
      for (let i = totalPages - 5; i <= totalPages; i++) list.push(i);
      return list;
    }
    list.push(1, "truncate", page - 1, page, page + 1, "truncate", totalPages);
    return list;
  };

  // ---------- Modal ----------
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [form, setForm] = useState<Partial<Lead>>({});

  const openNew = () => {
    setEditing(null);
    setForm({
      username: "",
      name: "",
      bank_name: "",
      bank: "",
      bank_no: "",
      phone_number: "",
    });
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showForm, closeModal]);

  const save = async () => {
    // tenant_id dari profiles
    const { data: { user } } = await supabase.auth.getUser();
    const { data: prof, error: eProf } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", user?.id)
      .single();
    if (eProf) {
      alert(eProf.message);
      return;
    }

    const payload: any = {
      username: form.username ?? null,
      name: form.name,
      bank_name: form.bank_name ?? null,
      bank: form.bank ?? null,
      bank_no: form.bank_no ?? null,
      phone_number: form.phone_number ?? null, // Whatsapp
      tenant_id: prof?.tenant_id, // RLS check
    };

    let error;
    if (editing) {
      const resp = await supabase
        .from("leads")
        .update(payload)
        .eq("id", editing.id)
        .select()
        .single();
      error = resp.error;
    } else {
      const resp = await supabase
        .from("leads")
        .insert(payload)
        .select()
        .single();
      error = resp.error;
    }

    if (error) {
      alert(error.message);
      return;
    }
    setShowForm(false);
    // Jika record baru, kemungkinan muncul di halaman 1 (karena sort desc)
    // supaya langsung terlihat, kembali ke halaman 1
    if (!editing) await load(1);
    else await load(page);
  };

  const onSubmitModal: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault(); // ENTER akan men-submit form
    await save();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={openNew}
          className="rounded bg-green-600 text-white px-4 py-2"
        >
          New Lead
        </button>
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1200px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* -------- Row FILTERS (di atas header) -------- */}
            <tr className="filters">
              <th>
                <input
                  placeholder="ID"
                  value={fId}
                  onChange={(e) => setFId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <input
                  placeholder="name"
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <input
                  placeholder="bank"
                  value={fBank}
                  onChange={(e) => setFBank(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <input
                  placeholder="bank name"
                  value={fBankName}
                  onChange={(e) => setFBankName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <input
                  placeholder="bank no"
                  value={fBankNo}
                  onChange={(e) => setFBankNo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <input
                  placeholder="whatsapp"
                  value={fWhatsapp}
                  onChange={(e) => setFWhatsapp(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <input
                  placeholder="username"
                  value={fUsername}
                  onChange={(e) => setFUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <div className="flex flex-col gap-1">
                  <input
                    type="date"
                    value={fStart}
                    onChange={(e) => setFStart(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Start date"
                  />
                  <input
                    type="date"
                    value={fFinish}
                    onChange={(e) => setFFinish(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Finish date"
                  />
                </div>
              </th>
              <th className="whitespace-nowrap">
                <button
                  onClick={applyFilters}
                  className="rounded bg-blue-600 text-white px-3 py-1"
                >
                  Submit
                </button>
              </th>
            </tr>

            {/* -------- Row HEADER -------- */}
            <tr>
              <th className="text-left">ID</th>
              <th className="text-left min-w-[240px]">Name</th>
              <th className="text-left">Bank</th>
              <th className="text-left min-w-[240px]">Bank Name</th>
              <th className="text-left">Bank No</th>
              <th className="text-left">Whatsapp</th>
              <th className="text-left">Username</th>
              <th className="text-left">Registration Date</th>
              <th className="text-left">Action</th>
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
                <tr key={r.id} className="hover:bg-gray-50">
                  <td>{r.id}</td>
                  <td className="whitespace-normal break-words min-w-[240px]">
                    {r.name}
                  </td>
                  <td>{r.bank ?? "-"}</td>
                  <td className="whitespace-normal break-words min-w-[240px]">
                    {r.bank_name ?? "-"}
                  </td>
                  <td>{r.bank_no ?? "-"}</td>
                  <td>{r.phone_number ?? "-"}</td>
                  <td>{r.username ?? "-"}</td>
                  <td>
                    {new Date(r.registration_date).toLocaleString("id-ID", {
                      timeZone: "Asia/Jakarta",
                    })}
                  </td>
                  <td>
                    <button
                      onClick={() => openEdit(r)}
                      className="rounded bg-gray-100 px-3 py-1"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ---------- Pagination ---------- */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button
            onClick={goFirst}
            disabled={!canPrev}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            First
          </button>
          <button
            onClick={goPrev}
            disabled={!canPrev}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Previous
          </button>

          {getPageList().map((it, idx) =>
            it === "truncate" ? (
              <span
                key={`t-${idx}`}
                className="px-3 py-1 rounded border bg-white text-gray-500"
              >
                Truncate
              </span>
            ) : (
              <button
                key={it}
                onClick={() => load(it)}
                className={`px-3 py-1 rounded border ${
                  page === it ? "bg-blue-600 text-white" : "bg-white"
                }`}
              >
                {it}
              </button>
            )
          )}

          <button
            onClick={goNext}
            disabled={!canNext}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={goLast}
            disabled={!canNext}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Last
          </button>
        </nav>
      </div>

      {/* ---------- Modal ---------- */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) closeModal(); // klik overlay -> close
          }}
        >
          {/* posisi lebih ke atas */}
          <form
            onSubmit={(e) => {
              e.preventDefault(); // ENTER akan men-submit form
              save();
            }}
            className="bg-white rounded border w-full max-w-2xl mt-10"
          >
            <div className="p-4 border-b flex justify-between items-center">
              <div className="font-semibold">
                {editing ? "Edit Lead" : "New Lead"}
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="text-sm"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="p-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1">Username</label>
                <input
                  className="border rounded px-3 py-2 w-full"
                  value={form.username ?? ""}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, username: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Name</label>
                <input
                  className="border rounded px-3 py-2 w-full"
                  value={form.name ?? ""}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, name: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Bank Name</label>
                <input
                  className="border rounded px-3 py-2 w-full"
                  value={form.bank_name ?? ""}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, bank_name: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Bank</label>
                <select
                  className="border rounded px-3 py-2 w-full"
                  value={form.bank ?? ""}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, bank: e.target.value }))
                  }
                >
                  <option value="">Pilih bank</option>
                  {[
                    "BCA",
                    "BRI",
                    "BNI",
                    "MANDIRI",
                    "BSI",
                    "CIMB",
                    "PERMATA",
                    "SEABANK",
                    "JAGO",
                    "DANA",
                    "OVO",
                    "GOPAY",
                    "SHOPEEPAY",
                    "LINKAJA",
                    "SAKUKU",
                    "OTHER",
                  ].map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1">Bank No</label>
                <input
                  className="border rounded px-3 py-2 w-full"
                  value={form.bank_no ?? ""}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, bank_no: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Whatsapp</label>
                <input
                  className="border rounded px-3 py-2 w-full"
                  placeholder="08xxxxxxxxxx"
                  value={form.phone_number ?? ""}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, phone_number: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="border-t p-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded px-4 py-2 bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded px-4 py-2 bg-blue-600 text-white"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
