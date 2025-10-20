"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";
import Link from "next/link";

function useSubmitGuard() {
  const lockRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const run = async <T,>(fn: () => Promise<T> | T) => {
    if (lockRef.current) return;      // sudah terkunci → abaikan submit berikutnya
    lockRef.current = true;
    setSubmitting(true);
    try {
      return await fn();
    } finally {
      setSubmitting(false);
      lockRef.current = false;
    }
  };

  return { submitting, run };
}

type DepositRow = {
  id: number;
  tenant_id: string;
  bank_id: number;
  lead_id: number | null;
  username: string;
  amount_gross: number;
  fee_amount: number;
  amount_net: number;
  txn_at: string;          // waktu dipilih (backdate)
  performed_at: string;    // waktu klik (real)
  status: "posted" | "reversed";
  created_by: string | null;

  // embed relasi
  lead?: { name: string | null } | null;

  // diisi di client dari tabel profiles
  created_by_name?: string | null;
};

const PAGE_SIZE = 25;
const SUMMARY_BATCH = 1000; // batch agregasi summary filter

function startOfDayJakartaISO(d: string) {
  return new Date(`${d}T00:00:00+07:00`).toISOString();
}
function endOfDayJakartaISO(d: string) {
  return new Date(`${d}T23:59:59.999+07:00`).toISOString();
}
function todayJakartaDateStr() {
  // yyyy-mm-dd di zona Asia/Jakarta
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
function nowLocalDatetimeValue() {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function DepositsTable() {
  const supabase = supabaseBrowser();

  // header summary (hari ini, berdasarkan waktu dipilih/backdate)
  const [sumToday, setSumToday] = useState<number>(0);
  const [countToday, setCountToday] = useState<number>(0);
  const [playersToday, setPlayersToday] = useState<number>(0);

  // header summary untuk hasil filter (override saat Submit/Enter)
  const [sumFiltered, setSumFiltered] = useState<number | null>(null);
  const [countFiltered, setCountFiltered] = useState<number | null>(null);
  const [playersFiltered, setPlayersFiltered] = useState<number | null>(null);
  const [useFilteredSummary, setUseFilteredSummary] = useState(false);

  // list & pagination
  const [rows, setRows] = useState<DepositRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [loading, setLoading] = useState(true);

  // filters — default: hari ini
  const [fLead, setFLead] = useState("");
  const [fUser, setFUser] = useState("");
  const [fStart, setFStart] = useState<string>(todayJakartaDateStr());
  const [fFinish, setFFinish] = useState<string>(todayJakartaDateStr());
  const [fDeleted, setFDeleted] = useState<"ALL" | "YES" | "NO">("ALL"); // YES → reversed

  // summary hari ini (txn_at dipilih)
  const loadToday = async () => {
    const y = todayJakartaDateStr();
    const s = startOfDayJakartaISO(y);
    const e = endOfDayJakartaISO(y);

    const { data, error } = await supabase
      .from("deposits")
      .select("amount_gross, username, status")
      .gte("txn_at", s)
      .lte("txn_at", e)
      .eq("status", "posted");

    if (error) {
      console.error(error);
      return;
    }
    const list = ((data ?? []) as { amount_gross: number; username: string }[]) || [];
    setSumToday(list.reduce((a, b) => a + Number(b.amount_gross || 0), 0));
    setCountToday(list.length);
    setPlayersToday(new Set(list.map((x) => x.username)).size);
  };

  // base select (mengikuti struktur baseline)
  const buildBaseSelect = () =>
    supabase
      .from("deposits")
      .select(
        `
        id, tenant_id, bank_id, lead_id, username,
        amount_gross, fee_amount, amount_net,
        txn_at, performed_at, status,
        created_by,
        lead:leads(name)
      `,
        { count: "exact" }
      )
      .order("txn_at", { ascending: false });

  const load = async (pageToLoad = page) => {
    setLoading(true);

    // Jika filter lead name diisi → cari ID lead dulu (karena select bawa satu nama saja)
    let leadIds: number[] | null = null;
    const leadName = fLead.trim();
    if (leadName) {
      const { data: leadList, error: eLead } = await supabase
        .from("leads")
        .select("id")
        .ilike("name", leadName)
        .limit(1000);
      if (eLead) {
        setLoading(false);
        alert(eLead.message);
        return;
      }
      leadIds = (leadList ?? []).map((x) => Number(x.id)).filter(Number.isFinite);
      if (leadIds.length === 0) {
        setRows([]);
        setTotal(0);
        setPage(1);
        setLoading(false);
        return;
      }
    }

    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = buildBaseSelect();

    if (leadIds) q = q.in("lead_id", leadIds);
    const user = fUser.trim();
    if (user) q = q.ilike("username", user); // exact (case-insensitive)
    if (fStart) q = q.gte("txn_at", startOfDayJakartaISO(fStart));
    if (fFinish) q = q.lte("txn_at", endOfDayJakartaISO(fFinish));
    if (fDeleted === "YES") q = q.eq("status", "reversed");
    if (fDeleted === "NO") q = q.eq("status", "posted");

    const { data, error, count } = await q.range(from, to);
    if (error) {
      setLoading(false);
      alert(error.message);
      return;
    }

    // ---- map created_by -> full_name (agar kolom By tidak UUID) ----
    const raw = ((data as any[]) ?? []) as DepositRow[];
    const ids = Array.from(
      new Set(raw.map((r) => r.created_by).filter(Boolean) as string[])
    );
    let nameMap = new Map<string, string>();
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", ids);
      (profs ?? []).forEach((p: any) => nameMap.set(p.user_id, p.full_name));
    }
    const withNames = raw.map((r) => ({
      ...r,
      created_by_name: r.created_by ? nameMap.get(r.created_by) ?? null : null,
    }));

    setRows(withNames);
    setTotal(count ?? 0);
    setPage(pageToLoad);
    setLoading(false);
  };

  useEffect(() => {
    // summary + load awal (sudah default filter hari ini)
    loadToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = (e?: React.FormEvent) => {
    e?.preventDefault();
    load(1); // filter berlaku saat Submit/Enter (bukan live)
    loadFilteredSummary(); // update header summary mengikuti filter
  };

  // ===== Summary mengikuti filter aktif (tanpa terpengaruh pagination) =====
  const loadFilteredSummary = async () => {
    // 1) Jika filter lead name diisi → cari ID lead dulu
    const user = fUser.trim();
    let leadIds: number[] | null = null;
    const leadName = fLead.trim();
    if (leadName) {
      const { data: leadList, error: eLead } = await supabase
        .from("leads")
        .select("id")
        .ilike("name", leadName)
        .limit(1000);
      if (eLead) {
        alert(eLead.message);
        return;
      }
      leadIds = (leadList ?? []).map((x) => Number(x.id)).filter(Number.isFinite);
      if (leadIds.length === 0) {
        setSumFiltered(0);
        setCountFiltered(0);
        setPlayersFiltered(0);
        setUseFilteredSummary(true);
        return;
      }
    }

    // 2) Hitung total baris yang match filter
    let qCount = supabase.from("deposits").select("id", { count: "exact", head: true });
    if (leadIds) qCount = qCount.in("lead_id", leadIds);
    if (user) qCount = qCount.ilike("username", user); // EXACT (tanpa wildcard)
    if (fStart) qCount = qCount.gte("txn_at", startOfDayJakartaISO(fStart));
    if (fFinish) qCount = qCount.lte("txn_at", endOfDayJakartaISO(fFinish));
    if (fDeleted === "YES") qCount = qCount.eq("status", "reversed");
    else if (fDeleted === "NO") qCount = qCount.eq("status", "posted");

    const { count: totalMatched, error: eCount } = await qCount;
    if (eCount) {
      alert(eCount.message);
      return;
    }
    if (!totalMatched) {
      setSumFiltered(0);
      setCountFiltered(0);
      setPlayersFiltered(0);
      setUseFilteredSummary(true);
      return;
    }

    // 3) Ambil data per-batch lalu agregasi (sum & distinct player)
    let from = 0;
    let sum = 0;
    const players = new Set<string>();
    while (from < totalMatched) {
      const to = Math.min(from + SUMMARY_BATCH - 1, totalMatched - 1);
      let q = supabase
        .from("deposits")
        .select("amount_gross, username")
        .order("txn_at", { ascending: false })
        .range(from, to);
      if (leadIds) q = q.in("lead_id", leadIds);
      if (user) q = q.ilike("username", user); // EXACT (tanpa wildcard)
      if (fStart) q = q.gte("txn_at", startOfDayJakartaISO(fStart));
      if (fFinish) q = q.lte("txn_at", endOfDayJakartaISO(fFinish));
      if (fDeleted === "YES") q = q.eq("status", "reversed");
      else if (fDeleted === "NO") q = q.eq("status", "posted");
      const { data, error } = await q;
      if (error) {
        alert(error.message);
        return;
      }
      const list = ((data ?? []) as { amount_gross: number; username: string }[]) || [];
      sum += list.reduce((a, b) => a + Number(b.amount_gross || 0), 0);
      // normalisasi agar 'Tester' dan 'tester' dianggap 1 pemain
      list.forEach((x) => players.add((x.username ?? "").trim().toLowerCase()));
      from += SUMMARY_BATCH;
    }
    setSumFiltered(sum);
    setCountFiltered(totalMatched);
    setPlayersFiltered(players.size);
    setUseFilteredSummary(true);
  }

  // ===== Delete (Reverse) modal =====
  const [delOpen, setDelOpen] = useState(false);
  const delGuard = useSubmitGuard();
  const [delNote, setDelNote] = useState("");
  const [delRow, setDelRow] = useState<DepositRow | null>(null);
  const [delBank, setDelBank] = useState<{
    bank_code: string;
    account_name: string;
    account_no: string;
  } | null>(null);

  // waktu reversal dipilih → dikunci (auto saat modal dibuka)
  const [delTxnAt, setDelTxnAt] = useState<string>(nowLocalDatetimeValue());

  const openDelete = async (r: DepositRow) => {
    setDelRow(r);
    setDelNote("");
    setDelOpen(true);
    setDelTxnAt(nowLocalDatetimeValue()); // default saat modal dibuka
    setDelBank(null);
    const { data: b } = await supabase
      .from("banks")
      .select("bank_code, account_name, account_no")
      .eq("id", r.bank_id)
      .single();
    if (b) setDelBank(b as any);
  };

  const closeDelete = useCallback(() => setDelOpen(false), []);

  // ESC close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && delOpen) {
        if (delGuard.submitting) { e.preventDefault(); return; } // ← kunci saat submit
        e.preventDefault();
        closeDelete();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [delOpen, closeDelete, delGuard.submitting]);

  const submitDelete = async () => {
    if (!delRow) return;
    if (!delNote.trim()) {
      alert("Keterangan Penghapusan wajib diisi");
      return;
    }
    const { error } = await supabase.rpc("reverse_deposit", {
      p_deposit_id: delRow.id,
      p_txn_at_final: new Date(delTxnAt).toISOString(), // waktu reversal (dikunci)
      p_reason: delNote.trim(),
    });
    if (error) {
      alert(error.message);
      return;
    }
    setDelOpen(false);
    await load(page);
    // refresh summary sesuai mode (hari ini vs filter)
    if (useFilteredSummary) {
      await loadFilteredSummary();
    } else {
      await loadToday();
    }
  };

  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="space-y-3">
      {/* Header summary */}
      <div className="rounded border bg-white p-3 text-sm">
        <b>Deposits</b>
        {useFilteredSummary && <span className="ml-1 text-gray-500">(filtered)</span>}{" "}
        | {formatAmount(useFilteredSummary ? (sumFiltered ?? 0) : sumToday)} |{" "}
        {useFilteredSummary ? (countFiltered ?? 0) : countToday} transaction |{" "}
        {useFilteredSummary ? (playersFiltered ?? 0) : playersToday} player
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table
          className="table-grid min-w-[1100px]"
          style={{ borderCollapse: "collapse" }}
        >
          <thead>
            {/* Row filters */}
            <tr className="filters">
              <th className="w-24"></th>
              <th>
                <input
                  placeholder="Lead name"
                  value={fLead}
                  onChange={(e) => setFLead(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <input
                  placeholder="Username"
                  value={fUser}
                  onChange={(e) => setFUser(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th></th>
              <th>
                <div className="flex flex-col gap-1">
                  <input
                    type="date"
                    value={fStart}
                    onChange={(e) => setFStart(e.target.value)}
                    className="border rounded px-2 py-1"
                  />
                  <input
                    type="date"
                    value={fFinish}
                    onChange={(e) => setFFinish(e.target.value)}
                    className="border rounded px-2 py-1"
                  />
                </div>
              </th>
              <th></th>
              <th>
                <select
                  value={fDeleted}
                  onChange={(e) => setFDeleted(e.target.value as any)}
                  className="border rounded px-2 py-1"
                >
                  <option value="ALL">ALL</option>
                  <option value="YES">YES</option>
                  <option value="NO">NO</option>
                </select>
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

            <tr>
              <th className="text-left w-24">ID</th>
              <th className="text-left min-w-[220px]">Lead</th>
              <th className="text-left min-w-[180px]">Player</th>
              {/* Amount rata kiri */}
              <th className="text-left w-32">Amount</th>
              <th className="text-left w-52">Tgl (dipilih)</th>
              <th className="text-left w-32">By</th>
              <th className="text-left w-24">Reversed?</th>
              <th className="text-left w-56 min-w-[13rem]">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8}>Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8}>No data</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td className="whitespace-normal break-words">
                    {r.lead?.name ?? "-"}
                  </td>
                  <td>{r.username}</td>
                  {/* Amount rata kiri */}
                  <td className="text-left">{formatAmount(r.amount_gross)}</td>
                  <td>
                    {new Date(r.txn_at).toLocaleString("id-ID", {
                      timeZone: "Asia/Jakarta",
                    })}
                  </td>
                  <td>{r.created_by_name ?? r.created_by ?? "-"}</td>
                  <td>{r.status === "reversed" ? "YES" : "NO"}</td>
                  <td className="whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <Link
                        href={`/deposits/${r.id}`}
                        className="rounded bg-gray-100 px-3 py-1 shrink-0"
                      >
                        Detail
                      </Link>
                      {r.status !== "reversed" && (
                        <button
                          onClick={() => openDelete(r)}
                          className="rounded bg-red-600 text-white px-3 py-1 shrink-0"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* pagination 50/halaman */}
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

      {/* Delete (Reverse) modal */}
      {delOpen && delRow && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (delGuard.submitting) return;                // ← jangan tutup saat submit
            if (e.currentTarget === e.target) closeDelete();
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              delGuard.run(submitDelete);
            }}
            onKeyDown={(e) => {
              if (delGuard.submitting && e.key === "Enter") e.preventDefault(); // blok Enter saat submit
            }}
            className="bg-white rounded border w-full max-w-2xl mt-10"
          >
            <div className="p-4 border-b font-semibold">
              Konfirmasi reverse deposit?
            </div>
            <div className="p-4">
              <table className="table-grid w-full">
                <tbody>
                  <tr>
                    <td className="w-40">Bank Penerima</td>
                    <td>
                      {delBank
                        ? `[${delBank.bank_code}] ${delBank.account_name} - ${delBank.account_no}`
                        : "Loading..."}
                    </td>
                  </tr>
                  <tr>
                    <td>Player</td>
                    <td>{delRow.username}</td>
                  </tr>
                  <tr>
                    <td>Jumlah (NET)</td>
                    <td>{formatAmount(delRow.amount_net)}</td>
                  </tr>
                  <tr>
                    <td>Direct Fee</td>
                    <td>{formatAmount(delRow.fee_amount)}</td>
                  </tr>
                  <tr>
                    <td>Tgl Transaksi (dipilih)</td>
                    <td>
                      {new Date(delRow.txn_at).toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                      })}
                    </td>
                  </tr>
                  <tr>
                    <td>Tgl Transaksi (Real)</td>
                    <td>
                      {new Date(delRow.performed_at).toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                      })}
                    </td>
                  </tr>
                  <tr>
                    <td>Tgl Reversal (dipilih)</td>
                    <td>
                      {/* dikunci: tampil saja, tidak bisa diubah */}
                      {new Date(delTxnAt).toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                      })}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-3">
                <label className="block text-xs mb-1">
                  Keterangan Penghapusan
                </label>
                <input
                  className="border rounded px-3 py-2 w-full"
                  value={delNote}
                  onChange={(e) => setDelNote(e.target.value)}
                />
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDelete}
                className="rounded px-4 py-2 bg-gray-100"
                disabled={delGuard.submitting}
                aria-disabled={delGuard.submitting}
              >
                Close
              </button>
              <button
                type="submit"
                className="rounded px-4 py-2 bg-red-600 text-white disabled:opacity-60"
                disabled={delGuard.submitting}
                aria-disabled={delGuard.submitting}
                title={delGuard.submitting ? "Reversing..." : "Submit"}
              >
                {delGuard.submitting ? "Reversing…" : "Submit"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
