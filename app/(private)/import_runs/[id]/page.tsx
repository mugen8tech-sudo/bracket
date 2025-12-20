// app/(private)/import_runs/[id]/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { formatAmount } from "@/lib/format";
import ImportRunItemsTable, { ImportRunItemRow } from "@/components/import-run-items-table";

type ImportStatus = "queued" | "processing" | "done" | "error" | "cancelled";
type ImportKind = "deposits" | "withdrawals";

function fmtJakarta(x?: string | null) {
  if (!x) return "-";
  return new Date(x).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

function kindLabel(k: ImportKind) {
  if (k === "deposits") return "Deposits";
  return "Withdrawals";
}

function statusLabel(s: ImportStatus) {
  return String(s || "").toUpperCase();
}

export default async function ImportRunDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServerComponentClient({ cookies });
  const id = Number(params.id);

  const { data: run, error } = await supabase
    .from("import_runs")
    .select(
      `
      id, kind, status,
      requested_at,
      period_start_at, period_end_at,

      file_name,
      panel_file_name,
      panel_approved_rows_total,
      panel_approved_rows_outside,

      users_total, matched_users, missing_users,
      panel_approved_rows, bracket_posted_rows,
      panel_total_amount, bracket_total_amount,
      error_message
    `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !run) {
    return <div className="rounded border bg-white p-4">Import run not found.</div>;
  }

  const canShowItems = run.status === "done";

  let items: ImportRunItemRow[] = [];
  if (canShowItems) {
    const { data: rows } = await supabase
      .from("import_run_items")
      .select("username, panel_total_amount, bracket_total_amount, diff_amount, panel_cnt, bracket_cnt, status")
      .eq("run_id", id)
      .order("username", { ascending: true });

    items = ((rows || []) as any[]).map((r) => ({
      username: String(r.username ?? ""),
      panel_total_amount: Number(r.panel_total_amount ?? 0),
      bracket_total_amount: Number(r.bracket_total_amount ?? 0),
      diff_amount: Number(r.diff_amount ?? 0),
      panel_cnt: Number(r.panel_cnt ?? 0),
      bracket_cnt: Number(r.bracket_cnt ?? 0),
      status: r.status,
    }));
  }

  const approvedTotal = Number(run.panel_approved_rows_total ?? 0);
  const approvedOutside = Number(run.panel_approved_rows_outside ?? 0);
  const approvedInPeriod = Number(run.panel_approved_rows ?? 0);

  const allApprovedOutsidePeriod = approvedTotal > 0 && approvedInPeriod === 0;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Import Run #{run.id}</h1>

      {/* Header */}
      <div className="rounded border bg-white">
        <table className="table-grid w-full">
          <tbody>
            <tr>
              <td className="w-56">Kind</td>
              <td className="font-semibold">{kindLabel(run.kind)}</td>
              <td className="w-56">Status</td>
              <td className="font-semibold">{statusLabel(run.status)}</td>
            </tr>

            <tr>
              <td>Requested at (JKT)</td>
              <td>{fmtJakarta(run.requested_at)}</td>
              <td>Period (JKT)</td>
              <td>
                {fmtJakarta(run.period_start_at)} - {fmtJakarta(run.period_end_at)}
              </td>
            </tr>

            <tr>
              <td>File (.xlsx)</td>
              <td colSpan={3} className="font-medium">
                {run.file_name ?? run.panel_file_name ?? "-"}
              </td>
            </tr>

            {run.status === "error" && (
              <tr>
                <td>Error</td>
                <td colSpan={3} className="text-red-700">
                  {run.error_message ?? "Unknown error"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Outside period warning */}
      {allApprovedOutsidePeriod && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Semua transaksi <b>Approved</b> di file berada di <b>luar periode</b> yang kamu pilih.
          Cek ulang <b>Start/End (JKT)</b> atau pastikan file export-nya benar.
          <div className="mt-1 text-xs">
            Outside: <b>{approvedOutside}</b> / Total Approved: <b>{approvedTotal}</b>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="rounded border bg-white">
        <div className="p-3 border-b font-semibold">Summary</div>
        <table className="table-grid w-full">
          <tbody>
            <tr>
              <td className="w-56 font-semibold">Users</td>
              <td className="text-right">{run.users_total ?? 0}</td>

              <td className="w-56 font-semibold">Matched</td>
              <td className="text-right">{run.matched_users ?? 0}</td>
            </tr>

            <tr>
              <td className="font-semibold">Missing</td>
              <td className="text-right">{run.missing_users ?? 0}</td>

              <td className="font-semibold">Panel Approve Rows (In Period)</td>
              <td className="text-right">{approvedInPeriod}</td>
            </tr>

            <tr>
              <td className="font-semibold">Panel Approved Total (File)</td>
              <td className="text-right">{approvedTotal}</td>

              <td className="font-semibold">Approved Outside Period</td>
              <td className="text-right">{approvedOutside}</td>
            </tr>

            <tr>
              <td className="font-semibold">Bracket Posted Rows</td>
              <td className="text-right">{run.bracket_posted_rows ?? 0}</td>

              <td className="font-semibold">Total Amount Panel</td>
              <td className="text-right font-mono">{formatAmount(run.panel_total_amount ?? 0)}</td>
            </tr>

            <tr>
              <td className="font-semibold">Total Amount Bracket</td>
              <td className="text-right font-mono">{formatAmount(run.bracket_total_amount ?? 0)}</td>
              <td></td>
              <td></td>
            </tr>
          </tbody>
        </table>

        {!canShowItems && (
          <div className="p-3 text-sm text-gray-600">
            Detail matching per-username hanya tersedia saat status <b>DONE</b>.
          </div>
        )}
      </div>

      {/* Items */}
      {canShowItems && <ImportRunItemsTable items={items} />}
    </div>
  );
}
