"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";
import Link from "next/link";

/** ===== Helpers tanggal (Asia/Jakarta) ===== */
function startOfDayJakartaISO(d: string) {
  return new Date(`${d}T00:00:00+07:00`).toISOString();
}
function endOfDayJakartaISO(d: string) {
  return new Date(`${d}T23:59:59.999+07:00`).toISOString();
}
function todayJakartaYMD() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

const PAGE_SIZE = 50;

/** Bentuk baris yang dipakai UI (disatukan dari dua skema) */
type UIRow = {
  id: number;
  tenant_id: string;
  bank_id: number;
  lead_id: number | null;
  lead_name: string | null;
  username: string | null;
  amount_net: number;
  fee_amount: number;          // fee_direct_amount (baru) | fee_amount (lama)
  txn_selected: string;        // txn_at_final (baru) | txn_at (lama)
  txn_real: string | null;     // txn_at_opened (baru) | performed_at (lama)
  created_by: string | null;
  deleted: boolean;            // is_deleted (baru) | status==='reversed' (lama)
};

export default function DepositsTable() {
  const supabase = supabaseBrowser();

  /** ===== Skema aktif: 'new' (snapshot) atau 'legacy' ===== */
  const [schema, setSchema] = useState<"new" | "legacy" | null>(null);

  /** ===== Header summary (hari ini) ===== */
  const [sumToday, setSumToday] = useState<number>(0);
  const [countToday, setCountToday] = useState<number>(0);
  const [playersToday, setPlayersToday] = useState<number>(0);

  /** ===== Data & pagination ===== */
  const [rows, setRows] = useState<UIRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [loading, setLoading] = useState(true);

  /** ===== Map pembuat → full_name ===== */
  const [creatorMap, setCreatorMap] = useState<Record<string, string>>({});

  /** ===== Filters (default = hari ini) ===== */
  const [fLead, setFLead] = useState("");
  const [fUser, setFUser] = useState("");
  const [fStart, setFStart] = useState<string>(todayJakartaYMD());
  const [fFinish, setFFinish] = useState<string>(todayJakartaYMD());
  const [fDeleted, setFDeleted] = useState<"ALL" | "YES" | "NO">("ALL");

  /** Deteksi skema sekali di awal */
  useEffect(() => {
    (async () => {
      // Cek kolom 'username_snapshot' → indikasi skema baru
      const { error } = await supabase
        .from("deposits")
        .select("username_snapshot")
        .limit(1);
      setSchema(error ? "legacy" : "new");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Summary hari ini (menyesuaikan skema) */
  const loadToday = useCallback(
    async (sch: "new" | "legacy") => {
      const y = todayJakartaYMD();
      const s = startOfDayJakartaISO(y);
      const e = endOfDayJakartaISO(y);

      if (sch === "new") {
        const { data, error } = await supabase
          .from("deposits")
          .select("amount_net, username_snapshot")
          .gte("txn_at_final", s)
          .lte("txn_at_final", e)
          .eq("is_deleted", false);
        if (error) return;
        const list =
          ((data ?? []) as { amount_net: number; username_snapshot: string }[]) ||
          [];
        setSumToday(list.reduce((a, b) => a + Number(b.amount_net || 0), 0));
        setCountToday(list.length);
        setPlayersToday(new Set(list.map((x) => x.username_snapshot)).size);
      } else {
        const { data, error } = await supabase
          .from("deposits")
          .select("amount_net, username")
          .gte("txn_at", s)
          .lte("txn_at", e)
          .eq("status", "posted");
        if (error) return;
        const list =
          ((data ?? []) as { amount_net: number; username: string }[]) || [];
        setSumToday(list.reduce((a, b) => a + Number(b.amount_net || 0), 0));
        setCountToday(list.length);
        setPlayersToday(new Set(list.map((x) => x.username)).size);
      }
    },
    [supabase]
  );

  /** Load list (menyesuaikan skema) */
  const load = useCallback(
    async (pageToLoad = page, sch?: "new" | "legacy") => {
      if (!schema && !sch) return; // tunggu deteksi skema
      const active = sch ?? (schema as "new" | "legacy");

      setLoading(true);
      const from = (pageToLoad - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      if (active === "new") {
        let q = supabase
          .from("deposits")
          .select(
            "id, tenant_id, bank_id, lead_id, username_snapshot, lead_name_snapshot, amount_gross, fee_direct_amount, amount_net, txn_at_final, txn_at_opened, created_by, is_deleted",
            { count: "exact" }
          )
          .order("txn_at_final", { ascending: false });

        if (fLead.trim())
          q = q.ilike("lead_name_snapshot", `%${fLead.trim()}%`);
        if (fUser.trim())
          q = q.ilike("username_snapshot", `%${fUser.trim()}%`);
        if (fStart) q = q.gte("txn_at_final", startOfDayJakartaISO(fStart));
        if (fFinish) q = q.lte("txn_at_final", endOfDayJakartaISO(fFinish));
        if (fDeleted === "YES") q = q.eq("is_deleted", true);
        if (fDeleted === "NO") q = q.eq("is_deleted", false);

        const { data, error, count } = await q.range(from, to);
        setLoading(false);
        if (error) {
          alert(error.message);
          return;
        }

        const list = (data as any[]) ?? [];
        const ui: UIRow[] = list.map((r) => ({
          id: r.id,
          tenant_id: r.tenant_id,
          bank_id: r.bank_id,
          lead_id: r.lead_id,
          lead_name: r.lead_name_snapshot ?? null,
          username: r.username_snapshot ?? null,
          amount_net: Number(r.amount_net || 0),
          fee_amount: Number(r.fee_direct_amount || 0),
          txn_selected: r.txn_at_final,
          txn_real: r.txn_at_opened ?? null,
          created_by: r.created_by ?? null,
          deleted: !!r.is_deleted,
        }));

        setRows(ui);
        setTotal(count ?? 0);
        setPage(pageToLoad);

        // map pembuat → full_name
        const creatorIds = Array.from(
          new Set(ui.map((r) => r.created_by).filter((v): v is string => !!v))
        );
        if (creatorIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, full_name")
            .in("user_id", creatorIds);
          const map =
            Object.fromEntries(
              ((profs ?? []) as { user_id: string; full_name: string }[]).map(
                (p) => [p.user_id, p.full_name]
              )
            ) || {};
          setCreatorMap(map);
        } else setCreatorMap({});
      } else {
        // LEGACY: username, txn_at, status, fee_amount
        // Jika filter "Lead name" → cari dulu ID lead
        let leadIds: number[] | null = null;
        if (fLead.trim()) {
          const { data: leadList, error: eLead } = await supabase
            .from("leads")
            .select("id")
            .ilike("name", `%${fLead.trim()}%`)
            .limit(1000);
          if (eLead) {
            setLoading(false);
            alert(eLead.message);
            return;
          }
          leadIds = (leadList ?? []).map((x) => Number(x.id));
          if (leadIds.length === 0) {
            setRows([]);
            setTotal(0);
            setPage(1);
            setLoading(false);
            return;
          }
        }

        let q = supabase
          .from("deposits")
          .select(
            "id, tenant_id, bank_id, lead_id, username, amount_gross, fee_amount, amount_net, txn_at, performed_at, status, created_by",
            { count: "exact" }
          )
          .order("txn_at", { ascending: false });

        if (leadIds) q = q.in("lead_id", leadIds);
        if (fUser.trim()) q = q.ilike("username", `%${fUser.trim()}%`);
        if (fStart) q = q.gte("txn_at", startOfDayJakartaISO(fStart));
        if (fFinish) q = q.lte("txn_at", endOfDayJakartaISO(fFinish));
        if (fDeleted === "YES") q = q.eq("status", "reversed");
        if (fDeleted === "NO") q = q.eq("status", "posted");

        const { data, error, count } = await q.range(from, to);
        setLoading(false);
        if (error) {
          alert(error.message);
          return;
        }

        const list = (data as any[]) ?? [];

        // ambil nama lead untuk tampilan
        const leadIdSet = Array.from(
          new Set(list.map((r) => r.lead_id).filter((v: any) => !!v))
        );
        let leadNameMap: Record<number, string> = {};
        if (leadIdSet.length) {
          const { data: leads2 } = await supabase
            .from("leads")
            .select("id, name")
            .in("id", leadIdSet);
          leadNameMap =
            Object.fromEntries(
              ((leads2 ?? []) as { id: number; name: string }[]).map((l) => [
                l.id,
                l.name,
              ])
            ) || {};
        }

        const ui: UIRow[] = list.map((r) => ({
          id: r.id,
          tenant_id: r.tenant_id,
          bank_id: r.bank_id,
          lead_id: r.lead_id,
          lead_name: (r.lead_id && leadNameMap[r.lead_id]) || null,
          username: r.username ?? null,
          amount_net: Number(r.amount_net || 0),
          fee_amount: Number(r.fee_amount || 0),
          txn_selected: r.txn_at,
          txn_real: r.performed_at ?? null,
          created_by: r.created_by ?? null,
          deleted: (r.status || "").toLowerCase() === "reversed",
        }));

        setRows(ui);
        setTotal(count ?? 0);
        setPage(pageToLoad);

        // map pembuat → full_name
        const creatorIds = Array.from(
          new Set(ui.map((r) => r.created_by).filter((v): v is string => !!v))
        );
        if (creatorIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, full_name")
            .in("user_id", creatorIds);
          const map =
            Object.fromEntries(
              ((profs ?? []) as { user_id: string; full_name: string }[]).map(
                (p) => [p.user_id, p.full_name]
              )
            ) || {};
          setCreatorMap(map);
        } else setCreatorMap({});
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fLead, fUser, fStart, fFinish, fDeleted, page, schema, supabase]
  );

  /** Initial load setelah skema terdeteksi */
  useEffect(() => {
    if (!schema) return;
    loadToday(schema);
    load(1, schema);
  }, [schema, load, loadToday]);

  const applyFilters = (e?: React.FormEvent) => {
    e?.preventDefault();
    load(1);
  };

  /** ===== Delete (Reversal) modal ===== */
  const [delOpen, setDelOpen] = useState(false);
  const [delNote, setDelNote] = useState("");
  const [delRow, setDelRow] = useState<UIRow | null>(null);
  const [delBank, setDelBank] = useState<{
    bank_code: string;
    account_name: string;
    account_no: string;
  } | null>(null);
  const [delRevAt] = useState<string>(new Date().toISOString()); // read-only default

  const openDelete = async (r: UIRow) => {
    setDelRow(r);
    setDelNote("");
    setDelOpen(true);
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
        e.preventDefault();
        closeDelete();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [delOpen, closeDelete]);

  const submitDelete = async () => {
    if (!delRow) return;
    if (!delNote.trim()) {
      alert("Keterangan Penghapusan wajib diisi");
      return;
    }
    // Server akan mencatat waktu real saat ini; waktu reversal (dipilih) ditampilkan read‑only.
    const { error } = await supabase.rpc("delete_deposit", {
      p_deposit_id: delRow.id,
      p_delete_note: delNote.trim(),
    });
    if (error) {
      alert(error.message);
      return;
    }
    setDelOpen(false);
    await load(page);
    await loadToday(schema as "new" | "legacy");
  };

  /** ===== Pagination helpers ===== */
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="space-y-3">
      {/* Header summary hari ini */}
      <div className="rounded border bg-white p-3 text-sm">
        <b>Deposits</b> | {formatAmount(sumToday)} | {countToday} transaction |{" "}
        {playersToday} player
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
              {/* Start/Finish atas-bawah, default = hari ini */}
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
              <th className="text-left w-32">Amount</th>
              <th className="text-left w-52">Tgl (dipilih)</th>
              <th className="text-left w-32">By</th>
              <th className="text-left w-24">Deleted?</th>
              <th className="text-left w-40">Action</th>
            </tr>
          </thead>
          <tbody>
            {!schema ? (
              <tr>
                <td colSpan={8}>Detecting schema…</td>
              </tr>
            ) : loading ? (
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
                    {r.lead_name ?? "-"}
                  </td>
                  <td>{r.username ?? "-"}</td>
                  <td className="text-left">{formatAmount(r.amount_net)}</td>
                  <td>
                    {new Date(r.txn_selected).toLocaleString("id-ID", {
                      timeZone: "Asia/Jakarta",
                    })}
                  </td>
                  <td>{(r.created_by && creatorMap[r.created_by]) || r.created_by || "-"}</td>
                  <td>{r.deleted ? "YES" : "NO"}</td>
                  <td className="space-x-2">
                    <Link
                      href={`/deposits/${r.id}`}
                      className="rounded bg-gray-100 px-3 py-1"
                    >
                      Detail
                    </Link>
                    {!r.deleted && (
                      <button
                        onClick={() => openDelete(r)}
                        className="rounded bg-red-600 text-white px-3 py-1"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* pagination */}
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

      {/* Delete modal */}
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
                    <td>{delRow.username ?? "-"}</td>
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
                      {new Date(delRow.txn_selected).toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                      })}
                    </td>
                  </tr>
                  <tr>
                    <td>Tgl Transaksi (Real)</td>
                    <td>
                      {delRow.txn_real
                        ? new Date(delRow.txn_real).toLocaleString("id-ID", {
                            timeZone: "Asia/Jakarta",
                          })
                        : "-"}
                    </td>
                  </tr>
                  <tr>
                    <td>Tgl Reversal (dipilih)</td>
                    <td>
                      {new Date(delRevAt).toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                      })}{" "}
                      <span className="text-gray-500 text-xs ml-2">
                        (auto, tidak bisa diubah)
                      </span>
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
                className="rounded px-4 py-2 bg-red-600 text-white"
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
