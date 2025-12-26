"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { supabaseBrowser } from "@/lib/supabase-browser";

type ExportKind =
  | "deposits"
  | "withdrawals"
  | "interbank_transfers"
  | "bank_adjustments"
  | "bank_expenses"
  | "credit_adjustments";

type ExportStatus = "queued" | "processing" | "done" | "error" | "cancelled";

type ExportRunRow = {
  id: number;
  kind: ExportKind;
  status: ExportStatus;

  requested_at: string;
  requested_by: string;

  period_start_at: string;
  period_end_at: string;

  file_name: string | null;
  rows_total: number;

  error_message?: string | null;
};

type ProfileLite = { user_id: string; full_name: string | null };

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

function statusTone(s: ExportStatus) {
  if (s === "done") return "bg-green-50 text-green-700 border-green-200";
  if (s === "processing") return "bg-blue-50 text-blue-700 border-blue-200";
  if (s === "queued") return "bg-amber-50 text-amber-700 border-amber-200";
  if (s === "cancelled") return "bg-gray-50 text-gray-700 border-gray-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function kindLabel(k: ExportKind) {
  if (k === "deposits") return "Deposits";
  if (k === "withdrawals") return "Withdrawals";
  if (k === "interbank_transfers") return "Interbank Transfer";
  if (k === "bank_adjustments") return "Bank Adjustment";
  if (k === "bank_expenses") return "Expenses";
  if (k === "credit_adjustments") return "Credit Adjustment";
  return k;
}

export default function ExportRunsHistory({ refreshKey }: { refreshKey?: number }) {
  const supabase = supabaseBrowser();

  const [authorized, setAuthorized] = useState<"loading" | "ok" | "no">("loading");
  const [rows, setRows] = useState<ExportRunRow[]>([]);
  const [byMap, setByMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const [rowBusy, setRowBusy] = useState<Record<number, "process" | "cancel" | "download">>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

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

  async function hydrateByMap(list: ExportRunRow[]) {
    const ids = Array.from(new Set(list.map((r) => r.requested_by).filter(Boolean)));
    if (ids.length === 0) {
      setByMap({});
      return;
    }

    const { data: profs } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", ids);

    const m: Record<string, string> = {};
    for (const p of ((profs as ProfileLite[] | null) ?? [])) {
      m[p.user_id] = p.full_name ?? p.user_id;
    }
    setByMap(m);
  }

  async function loadSummaryCounts() {
    // hitung total + per status (biar header tetap akurat walau paginated)
    const base = () => supabase.from("export_runs").select("id", { count: "exact", head: true });

    const [
      t,
      q,
      p,
      d,
      c,
      e,
    ] = await Promise.all([
      base(),
      base().eq("status", "queued"),
      base().eq("status", "processing"),
      base().eq("status", "done"),
      base().eq("status", "cancelled"),
      base().eq("status", "error"),
    ]);

    // kalau ada error, jangan bikin crash—pakai 0
    setSummary({
      total: t.count ?? 0,
      queued: q.count ?? 0,
      processing: p.count ?? 0,
      done: d.count ?? 0,
      cancelled: c.count ?? 0,
      err: e.count ?? 0,
    });
  }

  async function loadRuns(pageToLoad = page) {
    setLoading(true);
    setError("");

    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const resp = await supabase
      .from("export_runs")
      .select(
        [
          "id",
          "kind",
          "status",
          "requested_at",
          "requested_by",
          "period_start_at",
          "period_end_at",
          "file_name",
          "rows_total",
          "error_message",
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

    const list = ((resp.data ?? []) as unknown) as ExportRunRow[];
    setRows(list);
    setTotal(resp.count ?? list.length);
    setPage(pageToLoad);

    await hydrateByMap(list);
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
      const resp = await fetch("/api/public/export-runs/process-now", {
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
    if (!confirm("Cancel export run ini? Status akan jadi CANCELLED.")) return;

    setRowBusy((m) => ({ ...m, [runId]: "cancel" }));
    try {
      const resp = await fetch("/api/public/export-runs/cancel", {
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

  async function downloadRun(runId: number) {
    setRowBusy((m) => ({ ...m, [runId]: "download" }));
    try {
      const resp = await fetch("/api/public/export-runs/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Download failed");
      if (!json?.url) throw new Error("Signed URL not returned");
      window.open(String(json.url), "_blank", "noopener,noreferrer");
    } catch (e: any) {
      alert(e?.message || "Download failed");
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
          <div className="font-semibold">Recent Export Runs</div>
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
            <col style={{ width: "20%" }} /> {/* Run */}
            <col style={{ width: "12%" }} /> {/* Requested */}
            <col style={{ width: "12%" }} /> {/* By */}
            <col style={{ width: "24%" }} /> {/* Period */}
            <col style={{ width: "10%" }} /> {/* Rows */}
            <col style={{ width: "8%" }} /> {/* Status */}
            <col style={{ width: "14%" }} /> {/* Actions */}
          </colgroup>

          <thead>
            <tr>
              <th className="text-left">Run</th>
              <th className="text-left">Requested</th>
              <th className="text-left">By</th>
              <th className="text-left">Period (JKT)</th>
              <th className="text-left">Rows</th>
              <th className="text-left">Status</th>
              <th className="text-left">Actions</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => {
              const busy = rowBusy[r.id];
              const canProcess = r.status === "queued";
              const canCancel = r.status === "queued";
              const canDownload = r.status === "done";

              const req = fmtJakartaParts(r.requested_at);
              const start = fmtJakartaParts(r.period_start_at);
              const end = fmtJakartaParts(r.period_end_at);

              const byName = byMap[r.requested_by] ?? r.requested_by ?? "-";

              return (
                <tr key={r.id}>
                  <td className="align-top whitespace-normal break-words">
                    <div className="font-medium">{kindLabel(r.kind)}</div>
                    <div className="text-xs text-gray-600 break-words">{r.file_name ?? "-"}</div>
                    {r.status === "error" && r.error_message ? (
                      <div className="mt-1 text-[11px] text-red-700 whitespace-normal">
                        {r.error_message}
                      </div>
                    ) : null}
                  </td>

                  <td className="align-top whitespace-normal break-words">
                    <div className="font-mono text-xs">
                      <div className="font-semibold text-[12px]">{req.date}</div>
                      <div className="text-gray-700">{req.time}</div>
                    </div>
                  </td>

                  <td className="align-top whitespace-normal break-words">
                    <div className="text-sm">{byName}</div>
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

                  <td className="align-top whitespace-normal break-words">
                    <span className="font-mono">{Number(r.rows_total ?? 0)}</span>
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
                      >
                        {busy === "process" ? "…" : "Process"}
                      </button>

                      <button
                        type="button"
                        className="w-full rounded border px-2 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                        disabled={!canCancel || !!busy}
                        onClick={() => cancelRun(r.id)}
                      >
                        {busy === "cancel" ? "…" : "Cancel"}
                      </button>

                      <button
                        type="button"
                        className="w-full rounded border px-2 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                        disabled={!canDownload || !!busy}
                        onClick={() => downloadRun(r.id)}
                        title={canDownload ? "" : "Download hanya saat DONE"}
                      >
                        {busy === "download" ? "…" : "Download"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-500">
                  Belum ada riwayat export.
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
