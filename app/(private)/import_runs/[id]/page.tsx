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
  return k === "deposits" ? "Deposits" : "Withdrawals";
}

function statusLabel(s: ImportStatus) {
  return String(s || "").toUpperCase();
}

function statusTone(s: ImportStatus) {
  if (s === "done") return "bg-green-50 text-green-700 border-green-200";
  if (s === "processing") return "bg-blue-50 text-blue-700 border-blue-200";
  if (s === "queued") return "bg-amber-50 text-amber-700 border-amber-200";
  if (s === "cancelled") return "bg-gray-50 text-gray-700 border-gray-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function KVRow({
  label,
  value,
  valueClassName = "",
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 py-2">
      <div className="text-gray-600">{label}</div>
      <div className={valueClassName}>{value}</div>
    </div>
  );
}

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full">
      <div className="px-3 py-2 border-b bg-gray-50 font-semibold text-sm">{title}</div>
      <div className="px-3 divide-y text-sm">{children}</div>
    </div>
  );
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
      .select(
        "username, panel_total_amount, bracket_total_amount, diff_amount, panel_cnt, bracket_cnt, status",
      )
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

  const usersTotal = Number(run.users_total ?? 0);
  const usersMatched = Number(run.matched_users ?? 0);
  const usersMissing = Number(run.missing_users ?? 0);

  const rowsPanelIn = Number(run.panel_approved_rows ?? 0);
  const rowsBracket = Number(run.bracket_posted_rows ?? 0);

  const panelAmt = Number(run.panel_total_amount ?? 0);
  const bracketAmt = Number(run.bracket_total_amount ?? 0);
  const amountMissing = panelAmt - bracketAmt;

  const fileLabel = run.file_name ?? run.panel_file_name ?? "-";

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">
        Import Run #{run.id} ({kindLabel(run.kind)})
      </h1>

      {allApprovedOutsidePeriod && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Semua transaksi <b>Approved</b> di file berada di <b>luar periode</b> yang kamu pilih.
          Cek ulang <b>Start/End (JKT)</b> atau pastikan file export-nya benar.
          <div className="mt-1 text-xs">
            Outside: <b>{approvedOutside}</b> / Total Approved: <b>{approvedTotal}</b>
          </div>
        </div>
      )}

      {/* Summary: 1 tabel, 2 kolom (kiri/kanan), 2 baris blok */}
      <div className="rounded border bg-white overflow-hidden">
        <div className="p-3 border-b font-semibold">Summary</div>

        <table className="table-grid w-full">
          <colgroup>
            <col style={{ width: "50%" }} />
            <col style={{ width: "50%" }} />
          </colgroup>
          <tbody>
            <tr>
              <td className="align-top p-0">
                <Block title="Info">
                  <KVRow
                    label="Status"
                    value={
                      <span className={`inline-flex rounded border px-2 py-1 text-xs ${statusTone(run.status)}`}>
                        {statusLabel(run.status)}
                      </span>
                    }
                  />
                  <KVRow label="Requested at (JKT)" value={<span className="font-mono">{fmtJakarta(run.requested_at)}</span>} />
                  <KVRow
                    label="Period (JKT)"
                    value={
                      <span className="font-mono">
                        {fmtJakarta(run.period_start_at)} - {fmtJakarta(run.period_end_at)}
                      </span>
                    }
                  />
                  <KVRow
                    label="File (.xlsx)"
                    value={<span className="font-medium break-words">{fileLabel}</span>}
                    valueClassName="max-w-[420px] text-right"
                  />
                  {run.status === "error" && (
                    <KVRow
                      label="Error"
                      value={<span className="text-red-700">{run.error_message ?? "Unknown error"}</span>}
                      valueClassName="text-right"
                    />
                  )}
                </Block>
              </td>

              <td className="align-top p-0">
                <Block title="Rows (Approve/Post)">
                  <KVRow
                    label="Panel Approve Rows (In Period)"
                    value={<span className="font-mono">{rowsPanelIn}</span>}
                    valueClassName="text-right"
                  />
                  <KVRow
                    label="Bracket Posted Rows"
                    value={<span className="font-mono">{rowsBracket}</span>}
                    valueClassName="text-right"
                  />
                  <KVRow
                    label="Panel Approved Total (File)"
                    value={<span className="font-mono">{approvedTotal}</span>}
                    valueClassName="text-right"
                  />
                  <KVRow
                    label="Approved Outside Period"
                    value={<span className="font-mono">{approvedOutside}</span>}
                    valueClassName="text-right"
                  />
                </Block>
              </td>
            </tr>

            <tr>
              <td className="align-top p-0">
                <Block title="Users">
                  <KVRow label="Users" value={<span className="font-mono">{usersTotal}</span>} valueClassName="text-right" />
                  <KVRow label="Matched" value={<span className="font-mono">{usersMatched}</span>} valueClassName="text-right" />
                  <KVRow label="Missing" value={<span className="font-mono">{usersMissing}</span>} valueClassName="text-right" />
                </Block>
              </td>

              <td className="align-top p-0">
                <Block title="Amounts">
                  <KVRow label="Panel" value={<span className="font-mono">{formatAmount(panelAmt)}</span>} valueClassName="text-right" />
                  <KVRow label="Bracket" value={<span className="font-mono">{formatAmount(bracketAmt)}</span>} valueClassName="text-right" />
                  <KVRow
                    label="Missing"
                    value={<span className="font-mono">{formatAmount(amountMissing)}</span>}
                    valueClassName={`text-right ${Math.abs(amountMissing) < 0.000001 ? "text-gray-600" : "text-amber-700 font-semibold"}`}
                  />
                </Block>
              </td>
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
