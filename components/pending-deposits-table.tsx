"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/* ========= Helpers ========= */
const PAGE_SIZE = 50;

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
function toNumber(input: string) {
  let c = (input || "0").replace(/,/g, "");
  if (c.endsWith(".")) c = c.slice(0, -1);
  const n = Number(c);
  return isNaN(n) ? 0 : n;
}
function formatWithGroupingLive(raw: string) {
  let cleaned = raw.replace(/,/g, "").replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    cleaned =
      cleaned.slice(0, firstDot + 1) +
      cleaned.slice(firstDot + 1).replace(/\./g, "");
  }
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

/* ========= Types ========= */
type PendingDeposit = {
  id: number;
  tenant_id: string;
  bank_id: number;
  amount_gross: number;
  fee_amount: number;
  amount_net: number;
  opened_at: string | null;
  txn_at: string;                // waktu dipilih saat BUAT PDP
  performed_at: string;          // waktu real SAAT PDP dibuat
  description: string | null;

  bank_mutation_id: number;

  assigned_deposit_id: number | null;
  assigned_at: string | null;     // waktu real assign
  assigned_txn_at: string | null; // waktu dipilih assign
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

type ProfileLite = { user_id: string; full_name: string };
type LeadLite = {
  id: number;
  username: string | null;
  name: string | null;
  bank: string | null;
  bank_name: string | null;
  bank_no: string | null;
};

type BankMutationLite = {
  id: number;
  balance_before: number;
  balance_after: number;
};

type StatusFilter = "ALL" | "ASSIGNED" | "NOT_ASSIGNED";

/* ========= Komponen ========= */
export default function PendingDepositsTable() {
  const supabase = supabaseBrowser();

  // header summary
  const [notAssignedCount, setNotAssignedCount] = useState<number>(0);

  // data master
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [creatorMap, setCreatorMap] = useState<Record<string, string>>({});
  const [bmMap, setBmMap] = useState<Record<number, BankMutationLite>>({});

  // tabel
  const [rows, setRows] = useState<PendingDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // filters
  const [fId, setFId] = useState("");
  const [fStart, setFStart] = useState(todayJakartaYmd());
  const [fFinish, setFFinish] = useState(todayJakartaYmd());
  const [fBankId, setFBankId] = useState<number | "">("");
  const [fDesc, setFDesc] = useState("");
  const [fStatus, setFStatus] = useState<StatusFilter>("ALL");

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

  // query builder
  const buildQuery = () => {
    let q = supabase
      .from("pending_deposits")
      .select("*", { count: "exact" })
      .order("performed_at", { ascending: false });

    if (fId.trim()) {
      const n = Number(fId.trim());
      if (!Number.isNaN(n)) q = q.eq("id", n);
    }
    if (fStart) q = q.gte("performed_at", startOfDayJakartaISO(fStart));
    if (fFinish) q = q.lte("performed_at", endOfDayJakartaISO(fFinish));
    if (fBankId) q = q.eq("bank_id", Number(fBankId));
    if (fDesc.trim()) q = q.ilike("description", `%${fDesc.trim()}%`);

    if (fStatus === "ASSIGNED") q = q.not("assigned_deposit_id", "is", null);
    if (fStatus === "NOT_ASSIGNED") q = q.is("assigned_deposit_id", null);

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

    const list = (data as PendingDeposit[]) ?? [];
    setRows(list);
    setTotal(count ?? 0);
    setPage(pageToLoad);

    // join: bank_mutations untuk kolom Start/Finish
    const bmIds = Array.from(
      new Set(list.map((r) => r.bank_mutation_id).filter((v): v is number => !!v))
    );
    if (bmIds.length > 0) {
      const { data: bms } = await supabase
        .from("bank_mutations")
        .select("id, balance_before, balance_after")
        .in("id", bmIds);
      const map: Record<number, BankMutationLite> = {};
      for (const b of (bms as any[] | null) ?? []) {
        map[b.id] = {
          id: b.id,
          balance_before: Number(b.balance_before ?? 0),
          balance_after: Number(b.balance_after ?? 0),
        };
      }
      setBmMap(map);
    } else {
      setBmMap({});
    }

    // join: creator full_name
    const creatorIds = Array.from(
      new Set(list.map((r) => r.created_by).filter((v): v is string => !!v))
    );
    if (creatorIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", creatorIds);
      const map: Record<string, string> = {};
      for (const p of (profs as any[] | null) ?? []) map[p.user_id] = p.full_name;
      setCreatorMap(map);
    } else {
      setCreatorMap({});
    }

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

  const bankLabel = (id: number) => {
    const b = banks.find((x) => x.id === id);
    if (!b) return "[]";
    return `[${b.bank_code}] ${b.account_name} - ${b.account_no}`;
  };

  /* ====== Assign modal state (like DP) ====== */
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignRow, setAssignRow] = useState<PendingDeposit | null>(null);
  const [assignTxnAt, setAssignTxnAt] = useState<string>(nowLocalDatetimeValue());
  const [assignDesc, setAssignDesc] = useState<string>("");

  // player search (re-use pola dari DP) :contentReference[oaicite:1]{index=1}
  const [leadQuery, setLeadQuery] = useState<string>("");
  const [leadOptions, setLeadOptions] = useState<LeadLite[]>([]);
  const [leadPicked, setLeadPicked] = useState<LeadLite | null>(null);
  const [leadIndex, setLeadIndex] = useState<number>(0);
  const playerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!assignOpen) return;
      const q = leadQuery.trim();
      if (!q) {
        setLeadOptions([]);
        return;
      }
      const { data, error } = await supabase
        .from("leads")
        .select("id, username, name, bank, bank_name, bank_no")
        .ilike("username", q)
        .limit(10);
      if (!active) return;
      if (error) return;
      setLeadOptions((data as LeadLite[]) ?? []);
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
    setAssignDesc("");
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

  /* ====== Delete modal state ====== */
  const [delOpen, setDelOpen] = useState(false);
  const [delRow, setDelRow] = useState<PendingDeposit | null>(null);
  const [delNote, setDelNote] = useState("");

  const openDelete = (r: PendingDeposit) => {
    setDelRow(r);
    setDelNote("");
    setDelOpen(true);
  };

  const submitDelete = async () => {
    if (!delRow) return;
    const { error } = await supabase.rpc("delete_pending_deposit", {
      p_pending_id: delRow.id,
      p_txn_at_final: new Date().toISOString(), // tanpa input tanggal (sesuai screenshot)
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
          <table className="table-grid min-w-[1250px]" style={{ borderCollapse: "collapse" }}>
            <thead>
              {/* FILTERS */}
              <tr className="filters">
                <th className="w-24">
                  <input
                    placeholder="Cari ID"
                    value={fId}
                    onChange={(e) => setFId(e.target.value)}
                    className="w-full border rounded px-2 py-1"
                  />
                </th>
                <th className="w-56">
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
                <th className="w-56"></th>
                <th className="w-36">
                  <select
                    value={fBankId === "" ? "" : String(fBankId)}
                    onChange={(e) => setFBankId(e.target.value ? Number(e.target.value) : "")}
                    className="w-full border rounded px-2 py-1"
                  >
                    <option value="">All</option>
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        [{b.bank_code}] {b.account_name} - {b.account_no}
                      </option>
                    ))}
                  </select>
                </th>
                <th className="w-56">
                  <input
                    placeholder="Desc"
                    value={fDesc}
                    onChange={(e) => setFDesc(e.target.value)}
                    className="w-full border rounded px-2 py-1"
                  />
                </th>
                <th className="w-40">
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
                <th />
                <th />
                <th className="whitespace-nowrap">
                  <button type="submit" className="rounded bg-blue-600 text-white px-3 py-1">
                    submit
                  </button>
                </th>
              </tr>

              {/* HEADER */}
              <tr>
                <th className="text-left w-24">ID</th>
                <th className="text-left w-56">Waktu Click</th>
                <th className="text-left w-56">Waktu Dipilih</th>
                <th className="text-left w-36">Bank</th>
                <th className="text-left min-w-[260px]">Desc</th>
                <th className="text-left w-32">Status</th>
                <th className="text-right w-32">Amount (Gross)</th>
                <th className="text-right w-40">Start</th>
                <th className="text-right w-40">Finish</th>
                <th className="text-left w-40">Action</th>
                <th className="text-left w-40">Creator</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr><td colSpan={11}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={11}>No data</td></tr>
              ) : (
                rows.map((r) => {
                  const creator =
                    (r.created_by && creatorMap[r.created_by]) || r.created_by || "-";
                  const bm = r.bank_mutation_id ? bmMap[r.bank_mutation_id] : undefined;

                  const statusLabel =
                    r.assigned_deposit_id
                      ? `Player: ${r.assigned_username ?? "-"}`
                      : "PENDING ASSIGNMENT";

                  const actionEl =
                    r.assigned_deposit_id
                      ? <span className="text-gray-500">Sudah di Assign</span>
                      : r.deleted_at
                      ? <span className="text-gray-500">Sudah di Delete</span>
                      : (
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded bg-blue-600 text-white px-3 py-1"
                            onClick={() => openAssign(r)}
                          >
                            Assign
                          </button>
                          <button
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
                      <td>
                        {new Date(r.performed_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                      </td>
                      <td>
                        {new Date(r.txn_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                      </td>
                      <td className="whitespace-normal break-words">
                        <div className="font-semibold">{bankLabel(r.bank_id)}</div>
                        <div className="text-xs text-gray-600">Pending Depo</div>
                      </td>
                      <td className="whitespace-normal break-words">{r.description ?? "-"}</td>
                      <td>{statusLabel}</td>
                      <td className="text-right">{formatAmount(r.amount_gross)}</td>
                      <td className="text-right">{formatAmount(bm?.balance_before ?? 0)}</td>
                      <td className="text-right">{formatAmount(bm?.balance_after ?? 0)}</td>
                      <td>{actionEl}</td>
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

      {/* ====== MODAL ASSIGN ====== */}
      {assignOpen && assignRow && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) setAssignOpen(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitAssign();
            }}
            className="bg-white rounded border w-full max-w-2xl mt-10"
          >
            <div className="p-4 border-b font-semibold">
              Deposit to {bankLabel(assignRow.bank_id)}
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-500">Amount</div>
                  <div className="font-semibold">{formatAmount(assignRow.amount_gross)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Tgl Transaksi (PDP dibuat)</div>
                  <div className="font-semibold">
                    {new Date(assignRow.performed_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                  </div>
                </div>
              </div>

              {/* Player */}
              <div>
                <label className="block text-xs mb-1">Player</label>
                <div className="relative">
                  <input
                    ref={playerInputRef}
                    className="border rounded px-3 py-2 w-full"
                    placeholder="search username"
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

              {/* Waktu dipilih saat ASSIGN */}
              <div>
                <label className="block text-xs mb-1">Transaction Date (dipilih)</label>
                <input
                  type="datetime-local"
                  step="1"
                  className="border rounded px-3 py-2 w-full"
                  value={assignTxnAt}
                  onChange={(e) => setAssignTxnAt(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs mb-1">Description</label>
                <textarea
                  rows={3}
                  className="border rounded px-3 py-2 w-full"
                  value={assignDesc}
                  onChange={(e) => setAssignDesc(e.target.value)}
                />
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

      {/* ====== MODAL DELETE ====== */}
      {delOpen && delRow && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) setDelOpen(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitDelete();
            }}
            className="bg-white rounded border w-full max-w-2xl mt-10"
          >
            <div className="p-4 border-b font-semibold">Konfirmasi delete deposit?</div>
            <div className="p-4">
              <table className="table-grid w-full">
                <tbody>
                  <tr>
                    <td className="w-44">Bank Penerima</td>
                    <td>{bankLabel(delRow.bank_id)}</td>
                  </tr>
                  <tr>
                    <td>Jumlah</td>
                    <td>{formatAmount(delRow.amount_gross)}</td>
                  </tr>
                  <tr>
                    <td>Tgl Transaksi (PDP dibuat)</td>
                    <td>
                      {new Date(delRow.performed_at).toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                      })}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-3">
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
