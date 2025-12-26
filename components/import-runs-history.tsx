"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type ImportKind = "deposits" | "withdrawals";
type ImportStatus = "queued" | "processing" | "done" | "error" | "cancelled";

type ImportRunRow = {
  id: number;
  kind: ImportKind;
  status: ImportStatus;

  requested_at: string;
  requested_by: string; // NEW
  period_start_at: string;
  period_end_at: string;

  file_name: string | null;
  panel_file_name: string | null;
  panel_approved_rows_total: number;
  panel_approved_rows_outside: number;

  users_total: number;
  matched_users: number;
  missing_users: number;

  panel_approved_rows: number;
  bracket_posted_rows: number;

  panel_total_amount: number;
  bracket_total_amount: number;
};

const PAGE_SIZE = 10;

function fmtJakarta(x?: string | null) {
  if (!x) return "-";
  return new Date(x).toLocaleString("sv-SE", {
    timeZone: "Asia/Jakarta",
    hour12: false,
  });
}

function fmtJakartaParts(x?: string | null) {
  const s = fmtJakarta(x);
  if (s === "-") return { date: "-", time: "" };
  const [date, time] = s.split(" ");
  return { date: date ?? "-", time: time ?? "" };
}

function statusTone(s: ImportStatus) {
  if (s === "done") return "bg-green-50 text-green-700 border-green-200";
  if (s === "processing") return "bg-blue-50 text-blue-700 border-blue-200";
  if (s === "queued") return "bg-amber-50 text-amber-700 border-amber-200";
  if (s === "cancelled") return "bg-gray-50 text-gray-700 border-gray-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function kindLabel(k: ImportKind) {
  return k === "deposits" ? "Deposits" : "Withdrawals";
}

function shortUserId(x?: string | null) {
  const s = String(x || "");
  if (!s) return "-";
  if (s.length <= 10) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export default function ImportRunsHistory({ refreshKey }: { refreshKey?: number }) {
  const supabase = supabaseBrowser();

  const [authorized, setAuthorized] = useState<"loading" | "ok" | "no">("loading");
  const [rows, setRows] = useState<ImportRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const [rowBusy, setRowBusy] = useState<Record<number, "process" | "cancel">>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // NEW: map user_id -> display name (profiles.full_name)
  const [byMap, setByMap] = useState<Record<string, string>>({});

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const [summary, setSummary] = useState({
    total: 0,
    queued: 0,
    processing: 0,
    done: 0,
    cancelled: 0,
    err: 0,
  });

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setAuthorized("no");
        return;
      }

      const { data: prof, error: eProf } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .single();

      if (eProf || !prof) {
        setAuthorized("no");
        return;
      }

      const role = String((prof as any)?.role ?? "").toLowerCase();
      const allowed = new Set(["admin", "operator", "cs", "cs_dp", "cs_wd"]);
      setAuthorized(allowed.has(role) ? "ok" : "no");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSummaryCounts() {
    const base = () => supabase.from("import_runs").select("id", { count: "exact", head: true });

    const [t, q, p, d, c, e] = await Promise.all([
      base(),
      base().eq("status", "queued"),
      base().eq("status", "processing"),
      base().eq("status", "done"),
      base().eq("status", "cancelled"),
      base().eq("status", "error"),
    ]);

    setSummary({
      total: t.count ?? 0,
      queued: q.count ?? 0,
      processing: p.count ?? 0,
      done: d.count ?? 0,
      cancelled: c.count ?? 0,
      err: e.count ?? 0,
    });
  }

  async function loadByMap(userIds: string[]) {
    const uniq = Array.from(new Set(userIds.filter(Boolean)));
    if (uniq.length === 0) {
      setByMap({});
      return;
    }

    // profiles: user_id, full_name
    const { data, error } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", uniq);

    if (error) {
      // jangan bikin UI error hanya karena lookup nama gagal
      console.warn("loadByMap error:", error.message);
      setByMap({});
      return;
    }

    const m: Record<string, string> = {};
    for (const r of (data || []) as any[]) {
      const uid = String(r?.user_id || "");
      if (!uid) continue;
      m[uid] = String(r?.full_name || "").trim();
    }
    setByMap(m);
  }

  async function loadRuns(pageToLoad = page) {
    setLoading(true);
    setError("");

    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const resp = await supabase
      .from("import_runs")
      .select(
        [
          "id",
          "kind",
          "status",
          "requested_at",
          "requested_by", // NEW
          "period_start_at",
          "period_end_at",

          "file_name",
          "panel_file_name",
          "panel_approved_rows_total",
          "panel_approved_rows_outside",

          "users_total",
          "matched_users",
          "missing_users",
          "panel_approved_rows",
          "bracket_posted_rows",
          "panel_total_amount",
          "bracket_total_amount",
        ].join(", "),
        { count: "exact" },
      )
      .order("requested_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    setLoading(false);

    if (resp.error) {
      setError(resp.error.message);
      return;
    }

    const list = ((resp.data ?? []) as unknown) as ImportRunRow[];
    setRows(list);
    setTotal(resp.count ?? list.length);
    setPage(pageToLoad);

    // NEW: lookup display names for By column (page size kecil, aman)
    await loadByMap(list.map((r) => r.requested_by));

    await loadSummaryCounts();
  }

  useEffect(() => {
    if (authorized !== "ok") return;
    loadRuns(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, refreshKey]);

  const pageLabel = useMemo(() => {
    return `Page ${page} / ${totalPages}`;
  }, [page, totalPages]);

  async function processNow(runId: number) {
    setRowBusy((m) => ({ ...m, [runId]: "process" }));
    try {
      const resp = await fetch("/api/public/import-runs/process-now", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Process failed");
      await loadRuns(page);
    } catch (e: any) {
      alert(e?.message || "Process failed");
    } finally {
      setRowBusy((m) => {
        const x = { ...m };
        delete x[runId];
        return x;
      });
    }
  }

  async function cancelRun(runId: number) {
    if (!confirm("Cancel import run ini? Status akan jadi CANCELLED.")) return;

    setRowBusy((m) => ({ ...m, [runId]: "cancel" }));
    try {
      const resp = await fetch("/api/public/import-runs/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Cancel failed");
      await loadRuns(page);
    } catch (e: any) {
      alert(e?.message || "Cancel failed");
    } finally {
      setRowBusy((m) => {
        const x = { ...m };
        delete x[runId];
        return x;
      });
    }
  }

  if (authorized === "loading") {
    return <div className="rounded border bg-white p-4">Loading...</div>;
  }

  if (authorized === "no") {
    return <div className="rounded border bg-white p-4">Kamu tidak punya akses ke halaman ini.</div>;
  }

  return (
    <section className="rounded border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold">Recent Import Runs</div>
          <div className="text-xs text-gray-600">
            Total: {summary.total} • Queued: {summary.queued} • Processing: {summary.processing} •
            Done: {summary.done} • Cancelled: {summary.cancelled} • Error: {summary.err}
          </div>
        </div>

        <button
          type="button"
          onClick={() => loadRuns(page)}
          className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="w-full">
        <table className="table-grid table-fixed w-full text-sm">
          <colgroup>
            <col style={{ width: "17%" }} /> {/* Run */}
            <col style={{ width: "9%" }} /> {/* Requested */}
            <col style={{ width: "8%" }} /> {/* By (NEW) */}
            <col style={{ width: "18%" }} /> {/* Period */}
            <col style={{ width: "17%" }} /> {/* Users + Rows (merged) */}
            <col style={{ width: "15%" }} /> {/* Amounts */}
            <col style={{ width: "6%" }} /> {/* Status */}
            <col style={{ width: "10%" }} /> {/* Actions */}
          </colgroup>

          <thead>
            <tr>
              <th className="text-left">Run</th>
              <th className="text-left">Requested</th>
              <th className="text-left">By</th>
              <th className="text-left">Period (JKT)</th>
              <th className="text-left">Users</th>
              <th className="text-left">Amounts</th>
              <th className="text-left">Status</th>
              <th className="text-left">Actions</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => {
              const detailHref = `/import_runs/${r.id}`;
              const canOpen = r.status === "done";

              const busy = rowBusy[r.id];
              const canProcess = r.status === "queued";
              const canCancel = r.status === "queued";

              const fileLabel = r.file_name ?? r.panel_file_name ?? "-";

              // rows info (sebelumnya kolom Rows)
              const totalApproved = Number(r.panel_approved_rows_total ?? 0);
              const outsideApproved = Number(r.panel_approved_rows_outside ?? 0);
              const inPeriodApproved = Number(r.panel_approved_rows ?? 0);

              const showOutside =
                totalApproved > 0 && (outsideApproved > 0 || totalApproved !== inPeriodApproved);

              const req = fmtJakartaParts(r.requested_at);
              const start = fmtJakartaParts(r.period_start_at);
              const end = fmtJakartaParts(r.period_end_at);

              const byName = (byMap[r.requested_by] || "").trim();
              const byLabel = byName || shortUserId(r.requested_by);

              return (
                <tr key={r.id}>
                  <td className="align-top whitespace-normal break-words">
                    <div className="font-medium">{kindLabel(r.kind)}</div>
                    <div className="text-xs text-gray-600 break-words" title={fileLabel}>
                      {fileLabel}
                    </div>
                  </td>

                  <td className="align-top whitespace-normal break-words">
                    <div className="font-mono text-xs">
                      <div className="font-semibold text-[12px]">{req.date}</div>
                      <div className="text-gray-700">{req.time}</div>
                    </div>
                  </td>

                  {/* NEW: By */}
                  <td className="align-top whitespace-normal break-words">
                    <div className="text-xs">
                      <div className="font-medium">{byLabel}</div>
                    </div>
                  </td>

                  <td className="align-top whitespace-normal break-words">
                    <div className="text-xs leading-5">
                      <div>
                        <span className="text-gray-500">Start:</span>{" "}
                        <span className="font-mono">
                          {start.date} {start.time}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">End:</span>{" "}
                        <span className="font-mono">
                          {end.date} {end.time}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Users + Rows merged (with separator) */}
                  <td className="align-top whitespace-normal break-words">
                    <div className="text-xs space-y-1">
                      {/* USERS block */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-500">Users</span>
                        <span className="font-mono">{r.users_total}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-500">Matched</span>
                        <span className="font-mono">{r.matched_users}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-500">Missing</span>
                        <span className="font-mono">{r.missing_users}</span>
                      </div>

                      {/* separator */}
                      <div className="border-t pt-2 mt-2" />

                      {/* ROWS block (moved from Rows column) */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-500">Panel (in)</span>
                        <span className="font-mono">{inPeriodApproved}</span>
                      </div>

                      {showOutside && (
                        <div className="text-[11px] text-amber-700 whitespace-normal">
                          Total: <span className="font-mono">{totalApproved}</span>
                          {outsideApproved > 0 ? (
                            <>
                              {" "}
                              • Outside: <span className="font-mono">{outsideApproved}</span>
                            </>
                          ) : null}
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-500">Bracket</span>
                        <span className="font-mono">{r.bracket_posted_rows}</span>
                      </div>
                    </div>
                  </td>

                  <td className="align-top whitespace-normal break-words">
                    <div className="text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-500">Panel</span>
                        <span className="font-mono">{formatAmount(r.panel_total_amount)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-500">Bracket</span>
                        <span className="font-mono">{formatAmount(r.bracket_total_amount)}</span>
                      </div>
                    </div>
                  </td>

                  <td className="align-top whitespace-normal break-words">
                    <span
                      className={clsx(
                        "inline-flex items-center rounded border px-1 py-1 text-xs font-small",
                        statusTone(r.status),
                      )}
                    >
                      {r.status.toUpperCase()}
                    </span>
                  </td>

                  <td className="align-top whitespace-normal break-words">
                    <div className="flex flex-col gap-2 items-stretch">
                      <button
                        type="button"
                        className="w-full rounded border px-2 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                        disabled={!canProcess || !!busy}
                        onClick={() => processNow(r.id)}
                        title={canProcess ? "" : "Hanya bisa diproses saat QUEUED"}
                      >
                        {busy === "process" ? "…" : "Process"}
                      </button>

                      <button
                        type="button"
                        className="w-full rounded border px-2 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                        disabled={!canCancel || !!busy}
                        onClick={() => cancelRun(r.id)}
                        title={canCancel ? "" : "Hanya bisa dicancel saat QUEUED"}
                      >
                        {busy === "cancel" ? "…" : "Cancel"}
                      </button>

                      {canOpen ? (
                        <Link
                          className="w-full text-center inline-flex items-center justify-center rounded border px-2 py-1.5 text-xs hover:bg-gray-50"
                          href={detailHref}
                        >
                          Detail
                        </Link>
                      ) : (
                        <span className="w-full text-center inline-flex items-center justify-center rounded border px-2 py-1.5 text-xs text-gray-400 cursor-not-allowed">
                          Detail
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-gray-500">
                  Belum ada riwayat import.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm">
          <button
            onClick={() => page > 1 && loadRuns(1)}
            disabled={page <= 1 || loading}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            First
          </button>
          <button
            onClick={() => page > 1 && loadRuns(page - 1)}
            disabled={page <= 1 || loading}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Previous
          </button>

          <span className="px-3 py-1 rounded border bg-white">{pageLabel}</span>

          <button
            onClick={() => page < totalPages && loadRuns(page + 1)}
            disabled={page >= totalPages || loading}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={() => page < totalPages && loadRuns(totalPages)}
            disabled={page >= totalPages || loading}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Last
          </button>
        </nav>
      </div>
    </section>
  );
}
