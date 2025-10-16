"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/* ========= Helpers ========= */
const PAGE_SIZE = 25;

function todayJakartaYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
function startOfDayJakartaISO(ymd: string) {
  return new Date(`${ymd}T00:00:00+07:00`).toISOString();
}
function endOfDayJakartaISO(ymd: string) {
  return new Date(`${ymd}T23:59:59.999+07:00`).toISOString();
}
function nowLocalDatetimeValue() {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** Format "YYYY-MM-DD HH:mm:ss +0700" (WIB, no DST) */
function formatWIBWithOffset(iso?: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  const core = d.toLocaleString("sv-SE", {
    timeZone: "Asia/Jakarta",
    hour12: false,
  }); // "YYYY-MM-DD HH:mm:ss"
  return `${core} +0700`;
}

/* ========= Types ========= */
type PendingDeposit = {
  id: number;
  tenant_id: string;
  bank_id: number;
  amount_gross: number;
  fee_amount: number;
  amount_net: number;
  opened_at: string | null;

  txn_at: string; // waktu dipilih saat BUAT PDP
  performed_at: string; // waktu real SAAT PDP dibuat
  description: string | null;

  bank_mutation_id: number;

  assigned_deposit_id: number | null;
  assigned_at: string | null;
  assigned_txn_at: string | null;
  assigned_by: string | null;
  assigned_lead_id: number | null;
  assigned_username: string | null;

  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;

  created_by: string | null;
};

type BankLite = {
  id: number;
  bank_code: string;
  account_name: string;
  account_no: string;
};

type LeadLite = {
  id: number;
  username: string | null;
  name: string | null;
  bank: string | null;
  bank_name: string | null;
  bank_no: string | null;
};

type StatusFilter = "ALL" | "ASSIGNED" | "NOT_ASSIGNED";

/* ========= Komponen ========= */
export default function PendingDepositsTable() {
  const supabase = supabaseBrowser();

  // header summary
  const [notAssignedCount, setNotAssignedCount] = useState<number>(0);

  // data master
  const [banks, setBanks] = useState<BankLite[]>([]);

  // tabel
  const [rows, setRows] = useState<PendingDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // filters (versi simpel sesuai checkpoint)
  const [fStart, setFStart] = useState(todayJakartaYmd());
  const [fFinish, setFFinish] = useState(todayJakartaYmd());
  const [fStatus, setFStatus] = useState<StatusFilter>("NOT_ASSIGNED");

  // load list bank (untuk label)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("banks")
        .select("id, bank_code, account_name, account_no")
        .order("id", { ascending: false });
      setBanks(((data as BankLite[]) ?? []) as BankLite[]);
    })();
  }, [supabase]);

  // count header: NOT ASSIGNED (belum assign & belum delete)
  const loadHeaderCount = async () => {
    const { count } = await supabase
      .from("pending_deposits")
      .select("id", { count: "exact", head: true })
      .is("assigned_deposit_id", null)
      .is("deleted_at", null);
    setNotAssignedCount(count ?? 0);
  };

  // query builder (urut & filter by TGL = txn_at agar sesuai yang ditampilkan)
  const buildQuery = () => {
    let q = supabase
      .from("pending_deposits")
      .select("*", { count: "exact" })
      .order("txn_at", { ascending: false });

    if (fStart) q = q.gte("txn_at", startOfDayJakartaISO(fStart));
    if (fFinish) q = q.lte("txn_at", endOfDayJakartaISO(fFinish));

    if (fStatus === "ASSIGNED") q = q.not("assigned_deposit_id", "is", null);
    if (fStatus === "NOT_ASSIGNED") {
      q = q.is("assigned_deposit_id", null).is("deleted_at", null);
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

    setRows(((data as PendingDeposit[]) ?? []) as PendingDeposit[]);
    setTotal(count ?? 0);
    setPage(pageToLoad);

    setLoading(false);
    await loadHeaderCount();
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters: React.FormEventHandler = (e) => {
    e.preventDefault();
    load(1);
  };

  // ===== util label bank sesuai tampilan screenshot =====
  const bankLabel = (id: number) => {
    const b = banks.find((x) => x.id === id);
    if (!b) return "[]";
    return `[${b.bank_code}] ${b.account_name} - ${b.account_no}`;
  };

  /* ====== Assign modal state ====== */
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignRow, setAssignRow] = useState<PendingDeposit | null>(null);
  const [assignTxnAt, setAssignTxnAt] = useState<string>(nowLocalDatetimeValue());
  const [assignDesc] = useState<string>(""); // deskripsi dihilangkan dari UI, tetap kirim null

  // player search (EXACT match)
  const [leadQuery, setLeadQuery] = useState<string>("");
  const [leadOptions, setLeadOptions] = useState<LeadLite[]>([]);
  const [leadPicked, setLeadPicked] = useState<LeadLite | null>(null);
  const [leadIndex, setLeadIndex] = useState<number>(0);
  const playerInputRef = useRef<HTMLInputElement | null>(null);

  // ESC close untuk Assign & Delete
  const [delOpen, setDelOpen] = useState(false);
  const [delRow, setDelRow] = useState<PendingDeposit | null>(null);
  const [delNote, setDelNote] = useState("");

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (assignOpen) setAssignOpen(false);
        if (delOpen) setDelOpen(false);
      }
    };
    if (assignOpen || delOpen) window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [assignOpen, delOpen]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!assignOpen) return;
      const qRaw = leadQuery;
      const q = qRaw.trim();
      if (!q) {
        setLeadOptions([]);
        return;
      }
      // Exact, case-insensitive: ILIKE tanpa wildcard
      const { data, error } = await supabase
        .from("leads")
        .select("id, username, name, bank, bank_name, bank_no")
        .ilike("username", q)
        .limit(10);
      if (!active) return;
      if (error) return;
      // Filter lagi di FE untuk pastikan benar-benar exact (tanpa spasi)
      const exact = ((data as LeadLite[]) ?? []).filter(
        (opt) => (opt.username ?? "").trim().toLowerCase() === q.toLowerCase()
      );
      setLeadOptions(exact);
      setLeadIndex(0);
    })();
    return () => {
      active = false;
    };
  }, [leadQuery, assignOpen, supabase]);

  const openAssign = (r: PendingDeposit) => {
    setAssignRow(r);
    setAssignOpen(true);
    setAssignTxnAt(nowLocalDatetimeValue());
    setLeadPicked(null);
    setLeadOptions([]);
    setLeadIndex(0);
    setLeadQuery("");
    setTimeout(() => playerInputRef.current?.focus(), 0);
  };

  const submitAssign = async () => {
    if (!assignRow) return;
    if (!leadPicked || !leadPicked.username) {
      alert("Pilih Player (username) lebih dulu.");
      playerInputRef.current?.focus();
      return;
    }
    const iso = new Date(assignTxnAt).toISOString();
    const { error } = await supabase.rpc("assign_pending_deposit", {
      p_pending_id: assignRow.id,
      p_lead_id: leadPicked.id,
      p_username: leadPicked.username,
      p_txn_at_final: iso,
      p_description: assignDesc || null,
    });
    if (error) {
      alert(error.message);
      return;
    }
    setAssignOpen(false);
    await load(page);
  };

  /* ====== Delete helpers ====== */
  const openDelete = (r: PendingDeposit) => {
    setDelRow(r);
    setDelNote("");
    setDelOpen(true);
  };

  const submitDelete = async () => {
    if (!delRow) return;
    const { error } = await supabase.rpc("delete_pending_deposit", {
      p_pending_id: delRow.id,
      p_txn_at_final: new Date().toISOString(),
      p_reason: delNote || null,
    });
    if (error) {
      alert(error.message);
      return;
    }
    setDelOpen(false);
    await load(page);
  };

  const canPrev = page > 1;
  const canNext = page < totalPages;
  const pageLabel = useMemo(() => `Page ${page} / ${totalPages}`, [page, totalPages]);

  /* ====== RENDER ====== */
  return (
    <div className="space-y-3">
      <div className="rounded border bg-white p-3 text-sm">
        <b>Pending Deposits</b> | <b>({notAssignedCount})</b> not assigned
      </div>

      <div className="overflow-auto rounded border bg-white">
        <form onSubmit={applyFilters}>
          {/* table fixed + colgroup agar proporsional */}
          <table
            className="table-grid table-fixed w-full min-w-[1000px]"
            style={{ borderCollapse: "collapse" }}
          >
            <colgroup>
              <col style={{ width: "7%" }} />
              <col style={{ width: "43%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>

            <thead>
              {/* FILTERS: hanya di Tgl + Status + Action */}
              <tr className="filters">
                <th />
                <th />
                <th />
                <th>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs">Start</label>
                    <input
                      type="date"
                      value={fStart}
                      onChange={(e) => setFStart(e.target.value)}
                      className="border rounded px-2 py-1 w-full"
                    />
                    <label className="text-xs">Finish</label>
                    <input
                      type="date"
                      value={fFinish}
                      onChange={(e) => setFFinish(e.target.value)}
                      className="border rounded px-2 py-1 w-full"
                    />
                  </div>
                </th>
                <th>
                  <select
                    value={fStatus}
                    onChange={(e) => setFStatus(e.target.value as StatusFilter)}
                    className="w-full border rounded px-2 py-1"
                  >
                    <option value="ALL">ALL</option>
                    <option value="ASSIGNED">ASSIGNED</option>
                    <option value="NOT_ASSIGNED">NOT ASSIGNED</option>
                  </select>
                </th>
                <th>
                  <button type="submit" className="rounded bg-blue-600 text-white px-3 py-1">
                    submit
                  </button>
                </th>
              </tr>

              {/* HEADER */}
              <tr>
                <th className="text-left">ID</th>
                <th className="text-left">Bank</th>
                <th className="text-left">Amount</th>
                <th className="text-left">Tgl</th>
                <th className="text-left">Status</th>
                <th className="text-left">Action</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>Loading…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>No data</td>
                </tr>
              ) : (
                rows.map((r) => {
                  const statusLabel = r.assigned_deposit_id
                    ? `Player: ${r.assigned_username ?? "-"}`
                    : r.deleted_at
                    ? "DELETED"
                    : "PENDING ASSIGNMENT";

                  const actionEl =
                    r.assigned_deposit_id || r.deleted_at ? (
                      <span className="text-gray-500">
                        {r.assigned_deposit_id ? "Sudah di Assign" : "Sudah di Delete"}
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="rounded bg-blue-600 text-white px-3 py-1"
                          onClick={() => openAssign(r)}
                        >
                          Assign
                        </button>
                        <button
                          type="button"
                          className="rounded bg-red-600 text-white px-3 py-1"
                          onClick={() => openDelete(r)}
                        >
                          Delete
                        </button>
                      </div>
                    );

                  return (
                    <tr key={r.id} className="align-top">
                      <td>{r.id}</td>
                      <td className="whitespace-normal break-words">
                        <div className="font-semibold">{bankLabel(r.bank_id)}</div>
                        <div className="my-1 h-px bg-gray-200" />
                        <div className="text-xs text-gray-600">
                          {r.description && r.description.trim() !== "" ? r.description : "-"}
                        </div>
                      </td>
                      <td className="text-left">{formatAmount(r.amount_gross)}</td>
                      <td>
                        {/* gaya tampilan dd/mm/yy HH.mm (tetap) */}
                        {new Date(r.txn_at)
                          .toLocaleString("id-ID", {
                            timeZone: "Asia/Jakarta",
                            day: "2-digit",
                            month: "2-digit",
                            year: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })
                          .replace(",", "")
                          .replace(":", ".")}
                      </td>
                      <td>{statusLabel}</td>
                      <td>{actionEl}</td>
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

      {/* ====== MODAL ASSIGN (UI seperti contoh) ====== */}
      {assignOpen && assignRow && (
        <div
          className="fixed inset-0 bg-black/60 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) setAssignOpen(false); // klik overlay
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitAssign();
            }}
            className="bg-white rounded border w-full max-w-lg mt-14"
          >
            <div className="p-4 border-b font-semibold">
              Deposit to {bankLabel(assignRow.bank_id)}
            </div>

            <div className="p-4 space-y-3">
              {/* Amount (read only look) */}
              <div>
                <div className="text-xs mb-1">Amount</div>
                <div className="border rounded px-3 py-2 bg-gray-50">
                  {formatAmount(assignRow.amount_gross)}
                </div>
              </div>

              {/* Tgl Transaksi PDP dibuat (read only) */}
              <div>
                <div className="text-xs mb-1">Tgl Transaksi</div>
                <div className="border rounded px-3 py-2 bg-gray-50">
                  {formatWIBWithOffset(assignRow.performed_at)}
                </div>
              </div>

              {/* Transaction Date (dipilih) */}
              <div>
                <label className="block text-xs mb-1">Transaction Date</label>
                <input
                  type="datetime-local"
                  step="1"
                  className="border rounded px-3 py-2 w-full"
                  value={assignTxnAt}
                  onChange={(e) => setAssignTxnAt(e.target.value)}
                />
              </div>

              {/* Player: exact match only */}
              <div>
                <label className="block text-xs mb-1">Player</label>
                <div className="relative">
                  <input
                    ref={playerInputRef}
                    className="border rounded px-3 py-2 w-full"
                    placeholder="search"
                    value={leadPicked ? (leadPicked.username ?? "") : leadQuery}
                    onChange={(e) => {
                      setLeadPicked(null);
                      setLeadQuery(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (!leadPicked && leadOptions.length > 0) {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setLeadIndex((i) => Math.min(i + 1, leadOptions.length - 1));
                          return;
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setLeadIndex((i) => Math.max(i - 1, 0));
                          return;
                        }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const pick = leadOptions[Math.max(0, leadIndex)];
                          if (pick) {
                            setLeadPicked(pick);
                            setLeadOptions([]);
                          }
                          return;
                        }
                      }
                    }}
                  />
                  {/* dropdown suggestions (exact only) */}
                  {!leadPicked && leadOptions.length > 0 && (
                    <div className="absolute z-10 mt-1 max-h-56 overflow-auto w-full border bg-white rounded shadow">
                      {leadOptions.map((opt, idx) => (
                        <div
                          key={opt.id}
                          onClick={() => {
                            setLeadPicked(opt);
                            setLeadOptions([]);
                          }}
                          className={`px-3 py-2 cursor-pointer text-sm hover:bg-gray-100 ${
                            idx === leadIndex ? "bg-blue-50" : ""
                          }`}
                        >
                          {opt.username} ({opt.bank ?? opt.bank_name} | {opt.name} | {opt.bank_no})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t p-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAssignOpen(false)}
                className="rounded px-4 py-2 bg-gray-100"
              >
                Close
              </button>
              <button type="submit" className="rounded px-4 py-2 bg-blue-600 text-white">
                Submit
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ====== MODAL DELETE (ESC juga) ====== */}
      {delOpen && delRow && (
        <div
          className="fixed inset-0 bg-black/60 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) setDelOpen(false); // klik overlay
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitDelete();
            }}
            className="bg-white rounded border w-full max-w-lg mt-14"
          >
            <div className="p-4 border-b font-semibold">Konfirmasi delete deposit?</div>
            <div className="p-4 space-y-3">
              <div>
                <div className="text-xs mb-1">Bank Penerima</div>
                <div className="border rounded px-3 py-2 bg-gray-50">{bankLabel(delRow.bank_id)}</div>
              </div>
              <div>
                <div className="text-xs mb-1">Jumlah</div>
                <div className="border rounded px-3 py-2 bg-gray-50">
                  {formatAmount(delRow.amount_gross)}
                </div>
              </div>
              <div>
                <div className="text-xs mb-1">Tgl Transaksi</div>
                <div className="border rounded px-3 py-2 bg-gray-50">
                  {formatWIBWithOffset(delRow.performed_at)}
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1">Keterangan Penghapusan</label>
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
                onClick={() => setDelOpen(false)}
                className="rounded px-4 py-2 bg-gray-100"
              >
                Close
              </button>
              <button type="submit" className="rounded px-4 py-2 bg-red-600 text-white">
                Submit
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
