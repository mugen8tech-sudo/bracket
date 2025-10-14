"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/** ===== Helpers (konsisten dengan tabel lain) ===== */
function todayJakartaYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
function startOfDayJakartaISO(ymd: string) {
  return new Date(`${ymd}T00:00:00+07:00`).toISOString();
}
function endOfDayJakartaISO(ymd: string) {
  return new Date(`${ymd}T23:59:59.999+07:00`).toISOString();
}

/** ===== Types ===== */
type PendingDeposit = {
  id: number;
  tenant_id: string;
  bank_id: number;
  amount_gross: number;
  description: string | null;
  performed_at: string; // waktu real (klik)
  is_assigned: boolean;
  is_deleted: boolean;
  assigned_deposit_id: number | null;
  assigned_at: string | null;
  assigned_by: string | null;
};

type BankLite = {
  id: number;
  bank_code: string;
  account_name: string;
  account_no: string;
};

type DepositLite = {
  id: number;
  username: string | null;
};

type LeadLite = {
  id: number;
  username: string | null;
  name: string | null;
  bank: string | null;
  bank_name: string | null;
  bank_no: string | null;
};

/** ===== Komponen ===== */
export default function PendingDepositsTable() {
  const supabase = supabaseBrowser();

  // ringkasan header: total yg belum di-assign & belum di-delete
  const [unassignedTotal, setUnassignedTotal] = useState<number>(0);

  // filters
  const [fStart, setFStart] = useState(todayJakartaYmd());
  const [fFinish, setFFinish] = useState(todayJakartaYmd());
  const [fStatus, setFStatus] = useState<"ALL" | "NOT_ASSIGNED" | "ASSIGNED">(
    "NOT_ASSIGNED"
  );

  // data utama
  const [rows, setRows] = useState<PendingDeposit[]>([]);
  const [banks, setBanks] = useState<Record<number, BankLite>>({});
  const [depositMap, setDepositMap] = useState<Record<number, DepositLite>>({});
  const [loading, setLoading] = useState(true);

  // ======== Load header counter ========
  const loadHeaderCount = async () => {
    const { count } = await supabase
      .from("pending_deposits")
      .select("id", { count: "exact", head: true })
      .eq("is_assigned", false)
      .eq("is_deleted", false);
    setUnassignedTotal(count ?? 0);
  };

  // ======== Load table ========
  const load = async () => {
    setLoading(true);

    let q = supabase
      .from("pending_deposits")
      .select("*", { count: "exact" })
      .order("performed_at", { ascending: false });

    if (fStart) q = q.gte("performed_at", startOfDayJakartaISO(fStart));
    if (fFinish) q = q.lte("performed_at", endOfDayJakartaISO(fFinish));

    if (fStatus === "NOT_ASSIGNED") {
      q = q.eq("is_assigned", false);
    } else if (fStatus === "ASSIGNED") {
      q = q.eq("is_assigned", true);
    }

    const { data, error } = await q;
    if (error) {
      setLoading(false);
      alert(error.message);
      return;
    }
    const list = (data as PendingDeposit[]) ?? [];
    setRows(list);

    // lookups: banks
    const bankIds = Array.from(new Set(list.map((r) => r.bank_id)));
    if (bankIds.length > 0) {
      const { data: bList } = await supabase
        .from("banks")
        .select("id, bank_code, account_name, account_no")
        .in("id", bankIds);
      const map: Record<number, BankLite> = {};
      (bList ?? []).forEach((b: any) => (map[b.id] = b));
      setBanks(map);
    } else {
      setBanks({});
    }

    // lookups: assigned deposit → username
    const depIds = Array.from(
      new Set(
        list
          .map((r) => r.assigned_deposit_id)
          .filter((v): v is number => !!v)
      )
    );
    if (depIds.length > 0) {
      const { data: deps } = await supabase
        .from("deposits")
        .select("id, username")
        .in("id", depIds);
      const dmap: Record<number, DepositLite> = {};
      (deps ?? []).forEach((d: any) => (dmap[d.id] = d));
      setDepositMap(dmap);
    } else {
      setDepositMap({});
    }

    setLoading(false);
  };

  useEffect(() => {
    loadHeaderCount();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitFilters: React.FormEventHandler = async (e) => {
    e.preventDefault();
    await Promise.all([loadHeaderCount(), load()]);
  };

  // ======== Assign modal ========
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignRow, setAssignRow] = useState<PendingDeposit | null>(null);
  const [assignTxnAt, setAssignTxnAt] = useState<string>(() => {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate()
    )}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  });
  const [assignLeadQuery, setAssignLeadQuery] = useState("");
  const [assignLeadOpts, setAssignLeadOpts] = useState<LeadLite[]>([]);
  const [assignLeadPicked, setAssignLeadPicked] = useState<LeadLite | null>(
    null
  );
  const [assignLeadIndex, setAssignLeadIndex] = useState(0);
  const playerInputRef = useRef<HTMLInputElement | null>(null);

  const openAssign = (r: PendingDeposit) => {
    setAssignRow(r);
    setAssignOpen(true);
    setAssignLeadQuery("");
    setAssignLeadOpts([]);
    setAssignLeadPicked(null);
    setAssignLeadIndex(0);
    // default transaction date saat modal dibuka
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    setAssignTxnAt(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
        d.getHours()
      )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    );
  };
  const closeAssign = useCallback(() => setAssignOpen(false), []);

  // === Player search (identik dengan banks-table: exact ILIKE + navigasi keyboard) ===
  useEffect(() => {
    let active = true;
    (async () => {
      if (!assignOpen) return;
      const q = assignLeadQuery.trim();
      if (!q || assignLeadPicked) {
        setAssignLeadOpts([]);
        return;
      }
      const { data, error } = await supabase
        .from("leads")
        .select("id, username, name, bank, bank_name, bank_no")
        .ilike("username", q.trim()) // TANPA wildcard—samakan dengan banks-table
        .limit(10);
      if (!active) return;
      if (!error) {
        setAssignLeadOpts((data as LeadLite[]) ?? []);
        setAssignLeadIndex(0);
      }
    })();
    return () => {
      active = false;
    };
  }, [assignLeadQuery, assignLeadPicked, assignOpen, supabase]); // ← sama pola dependensi
  // (mengikuti pola DP/WD di banks-table untuk pengalaman yang konsisten). :contentReference[oaicite:1]{index=1}

  const submitAssign = async () => {
    if (!assignRow) return;
    if (!assignLeadPicked || !assignLeadPicked.username) {
      alert("Pilih Player (username) terlebih dahulu.");
      playerInputRef.current?.focus();
      return;
    }
    const { error } = await supabase.rpc("assign_pending_deposit", {
      p_pending_deposit_id: assignRow.id,
      p_lead_id: assignLeadPicked.id,
      p_username: assignLeadPicked.username,
      p_txn_at_final: new Date(assignTxnAt).toISOString(),
    });
    if (error) {
      alert(error.message);
      return;
    }
    setAssignOpen(false);
    await Promise.all([loadHeaderCount(), load()]);
  };

  // ======== Delete modal ========
  const [delOpen, setDelOpen] = useState(false);
  const [delRow, setDelRow] = useState<PendingDeposit | null>(null);
  const [delNote, setDelNote] = useState("");

  const openDelete = (r: PendingDeposit) => {
    setDelRow(r);
    setDelNote("");
    setDelOpen(true);
  };
  const closeDelete = useCallback(() => setDelOpen(false), []);

  const submitDelete = async () => {
    if (!delRow) return;
    if (!delNote.trim()) {
      alert("Keterangan Penghapusan wajib diisi");
      return;
    }
    const { error } = await supabase.rpc("delete_pending_deposit", {
      p_pending_deposit_id: delRow.id,
      p_reason: delNote.trim(),
    });
    if (error) {
      alert(error.message);
      return;
    }
    setDelOpen(false);
    await Promise.all([loadHeaderCount(), load()]);
  };

  /** ======== ESC close (disamakan dengan Deposits & Withdrawals) ======== */
  useEffect(() => {
    if (!assignOpen && !delOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (assignOpen) closeAssign();
        if (delOpen) closeDelete();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [assignOpen, delOpen, closeAssign, closeDelete]);

  // ======== Render helpers ========
  const headerTitle = useMemo(
    () => `Pending Deposits | (${unassignedTotal}) not assigned`,
    [unassignedTotal]
  );

  const bankLabel = (r: PendingDeposit) => {
    const b = banks[r.bank_id];
    if (!b) return "[]";
    return `[${b.bank_code}] ${b.account_name} - ${b.account_no}`;
  };

  const statusCell = (r: PendingDeposit) => {
    if (r.is_assigned) {
      const dep = r.assigned_deposit_id
        ? depositMap[r.assigned_deposit_id]
        : undefined;
      const username = dep?.username ?? "-";
      return (
        <>
          <div>Player: {username}</div>
          <div className="text-xs text-gray-500">Sudah di assign</div>
        </>
      );
    }
    return (
      <>
        <div>PENDING ASSIGNMENT</div>
        {r.is_deleted && (
          <div className="text-xs text-gray-500">Sudah di Delete</div>
        )}
      </>
    );
  };

  return (
    <div className="space-y-3">
      <div className="rounded border bg-white p-3 text-sm">
        <b>{headerTitle}</b>
      </div>

      <div className="overflow-auto rounded border bg-white">
        <form onSubmit={submitFilters}>
          <table
            className="table-grid min-w-[1100px]"
            style={{ borderCollapse: "collapse" }}
          >
            <thead>
              {/* ===== Filter bar ===== */}
              <tr className="filters">
                <th className="w-20" />
                <th className="w-[360px]" />
                <th className="w-32" />
                <th className="w-52">
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
                <th className="w-[220px]">
                  <select
                    value={fStatus}
                    onChange={(e) =>
                      setFStatus(
                        e.target.value as "ALL" | "NOT_ASSIGNED" | "ASSIGNED"
                      )
                    }
                    className="border rounded px-2 py-1 w-full max-w-[180px]"
                  >
                    <option value="ALL">ALL</option>
                    <option value="ASSIGNED">ASSIGNED</option>
                    <option value="NOT_ASSIGNED">NOT ASSIGNED</option>
                  </select>
                </th>
                <th className="w-[160px] text-right">
                  <button
                    type="submit"
                    className="rounded bg-blue-600 text-white px-3 py-1"
                  >
                    submit
                  </button>
                </th>
              </tr>

              {/* ===== Header kolom ===== */}
              <tr>
                <th className="text-left w-20">ID</th>
                <th className="text-left min-w-[360px]">Bank</th>
                <th className="text-left w-32">Amount</th>
                <th className="text-left w-52">Tgl</th>
                <th className="text-left w-[220px]">Status</th>
                <th className="text-left w-[160px]">Action</th>
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
                rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="py-1">{r.id}</td>
                    <td className="whitespace-normal break-words py-1">
                      <div className="font-semibold">{bankLabel(r)}</div>
                      <div className="my-1 h-px bg-gray-200" />
                      <div className="text-sm text-gray-700">
                        {r.description ?? "-"}
                      </div>
                    </td>
                    <td className="text-left py-1">
                      {formatAmount(r.amount_gross)}
                    </td>
                    <td className="py-1 whitespace-nowrap">
                      {new Date(r.performed_at).toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                      })}
                    </td>
                    <td className="whitespace-normal break-words py-1">
                      {statusCell(r)}
                    </td>
                    <td className="space-x-2 py-1">
                      {!r.is_assigned && !r.is_deleted ? (
                        <>
                          <button
                            onClick={() => openAssign(r)}
                            className="rounded bg-blue-600 text-white px-3 py-1"
                            type="button"
                          >
                            Assign
                          </button>
                          <button
                            onClick={() => openDelete(r)}
                            className="rounded bg-red-600 text-white px-3 py-1"
                            type="button"
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <span className="text-sm text-gray-600">
                          {r.is_assigned ? "Sudah di assign" : "Sudah di Delete"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </form>
      </div>

      {/* ===== Modal: ASSIGN ===== */}
      {assignOpen && assignRow && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) closeAssign();
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
              Deposit to{" "}
              {banks[assignRow.bank_id]
                ? `[${banks[assignRow.bank_id].bank_code}] ${banks[assignRow.bank_id].account_name} - ${banks[assignRow.bank_id].account_no}`
                : "-"}
            </div>
            <div className="p-4 space-y-3">
              <table className="table-grid w-full">
                <tbody>
                  <tr>
                    <td className="w-40">Amount</td>
                    <td>{formatAmount(assignRow.amount_gross)}</td>
                  </tr>
                  <tr>
                    <td>Tgl Transaksi</td>
                    <td>
                      {new Date(assignRow.performed_at).toLocaleString(
                        "id-ID",
                        {
                          timeZone: "Asia/Jakarta",
                        }
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>

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

              <div>
                <label className="block text-xs mb-1">Player</label>
                <div className="relative">
                  <input
                    ref={playerInputRef}
                    className="border rounded px-3 py-2 w-full"
                    placeholder="search username"
                    value={
                      assignLeadPicked
                        ? assignLeadPicked.username ?? ""
                        : assignLeadQuery
                    }
                    onChange={(e) => {
                      setAssignLeadPicked(null);
                      setAssignLeadQuery(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (!assignLeadPicked && assignLeadOpts.length > 0) {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setAssignLeadIndex((i) =>
                            Math.min(i + 1, assignLeadOpts.length - 1)
                          );
                          return;
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setAssignLeadIndex((i) => Math.max(i - 1, 0));
                          return;
                        }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const pick =
                            assignLeadOpts[Math.max(0, assignLeadIndex)];
                          if (pick) {
                            setAssignLeadPicked(pick);
                            setAssignLeadOpts([]);
                          }
                          return;
                        }
                      }
                    }}
                  />
                  {!assignLeadPicked && assignLeadOpts.length > 0 && (
                    <div className="absolute z-10 mt-1 max-h-56 overflow-auto w-full border bg-white rounded shadow">
                      {assignLeadOpts.map((opt, idx) => (
                        <div
                          key={opt.id}
                          onClick={() => {
                            setAssignLeadPicked(opt);
                            setAssignLeadOpts([]);
                          }}
                          className={`px-3 py-2 cursor-pointer text-sm hover:bg-gray-100 ${
                            idx === assignLeadIndex ? "bg-blue-50" : ""
                          }`}
                        >
                          {opt.username} ({opt.bank ?? opt.bank_name} |{" "}
                          {opt.name} | {opt.bank_no})
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
                onClick={closeAssign}
                className="rounded px-4 py-2 bg-gray-100"
              >
                Close
              </button>
              <button
                type="submit"
                className="rounded px-4 py-2 bg-blue-600 text-white"
              >
                Submit
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Modal: DELETE ===== */}
      {delOpen && delRow && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) closeDelete();
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitDelete();
            }}
            className="bg-white rounded border w-full max-w-2xl mt-10"
          >
            <div className="p-4 border-b font-semibold">
              Konfirmasi delete deposit?
            </div>
            <div className="p-4">
              <table className="table-grid w-full">
                <tbody>
                  <tr>
                    <td className="w-40">Bank Penerima</td>
                    <td>
                      {banks[delRow.bank_id]
                        ? `[${banks[delRow.bank_id].bank_code}] ${banks[delRow.bank_id].account_name} - ${banks[delRow.bank_id].account_no}`
                        : "-"}
                    </td>
                  </tr>
                  <tr>
                    <td>Jumlah</td>
                    <td>{formatAmount(delRow.amount_gross)}</td>
                  </tr>
                  <tr>
                    <td>Tgl Transaksi</td>
                    <td>
                      {new Date(delRow.performed_at).toLocaleString("id-ID", {
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
              >
                Close
              </button>
              <button
                type="submit"
                className="rounded px-4 py-2 bg-blue-600 text-white"
              >
                Submit
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
