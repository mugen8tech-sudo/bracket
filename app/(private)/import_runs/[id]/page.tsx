// app/(private)/import_runs/[id]/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { cookies } from "next/headers";
import Link from "next/link";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { formatAmount } from "@/lib/format";

type ImportStatus = "queued" | "processing" | "done" | "error" | "cancelled";
type ImportKind = "deposits" | "withdrawals";

type ItemStatus = "MATCHED" | "LEBIH_BRACKET" | "LEBIH_PANEL";

type ImportRunItemRow = {
  username: string;
  panel_total_amount: number;
  bracket_total_amount: number;
  diff_amount: number;
  panel_cnt: number;
  bracket_cnt: number;
  status: ItemStatus;
};

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

function itemStatusLabel(s: ItemStatus) {
  if (s === "MATCHED") return "MATCHED";
  if (s === "LEBIH_BRACKET") return "LEBIH BRACKET";
  return "LEBIH PANEL";
}

function itemStatusTone(s: ItemStatus) {
  if (s === "MATCHED") return "bg-green-50 text-green-700 border-green-200";
  if (s === "LEBIH_BRACKET") return "bg-blue-50 text-blue-700 border-blue-200";
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

function buildQS(base: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v == null) continue;
    const vv = String(v).trim();
    if (!vv) continue;
    sp.set(k, vv);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default async function ImportRunDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const supabase = createServerComponentClient({ cookies });
  const id = Number(params.id);

  const getSP = (key: string) => {
    const v = searchParams?.[key];
    if (Array.isArray(v)) return v[0] ?? "";
    return v ?? "";
  };

  const q = String(getSP("q") || "").trim();
  const statusRaw = String(getSP("status") || "all").toLowerCase();

  const pageSize = 25;
  const page = Math.max(1, Number(getSP("page") || "1") || 1);

  const statusFilter: "all" | ItemStatus =
    statusRaw === "matched"
      ? "MATCHED"
      : statusRaw === "lebih_bracket"
        ? "LEBIH_BRACKET"
        : statusRaw === "lebih_panel"
          ? "LEBIH_PANEL"
          : "all";

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

  // =========================
  // Items: COUNT + PAGE DATA
  // =========================
  let items: ImportRunItemRow[] = [];
  let totalItems = 0;
  let cntMatched = 0;
  let cntLebihBracket = 0;
  let cntLebihPanel = 0;
  let totalPages = 1;
  let safePage = page;

  if (canShowItems) {
    // total items (respect filter + search)
    let countQb = supabase
      .from("import_run_items")
      .select("username", { count: "exact", head: true })
      .eq("run_id", id);

    if (q) countQb = countQb.ilike("username", `%${q}%`);
    if (statusFilter !== "all") countQb = countQb.eq("status", statusFilter);

    const { count: totalCount, error: cErr } = await countQb;
    totalItems = cErr ? 0 : Number(totalCount ?? 0);

    totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    safePage = Math.min(Math.max(1, page), totalPages);

    // counts per status (respect search q; kalau user pilih filter status tertentu, count lain jadi 0 biar konsisten)
    const countByStatus = async (st: ItemStatus) => {
      if (statusFilter !== "all" && statusFilter !== st) return 0;

      let qb = supabase
        .from("import_run_items")
        .select("username", { count: "exact", head: true })
        .eq("run_id", id)
        .eq("status", st);

      if (q) qb = qb.ilike("username", `%${q}%`);

      const { count, error: e2 } = await qb;
      if (e2) return 0;
      return Number(count ?? 0);
    };

    cntMatched = await countByStatus("MATCHED");
    cntLebihBracket = await countByStatus("LEBIH_BRACKET");
    cntLebihPanel = await countByStatus("LEBIH_PANEL");

    // page data (use safePage)
    const from = (safePage - 1) * pageSize;
    const to = from + pageSize - 1;

    let listQb = supabase
      .from("import_run_items")
      .select("username, panel_total_amount, bracket_total_amount, diff_amount, panel_cnt, bracket_cnt, status")
      .eq("run_id", id)
      .order("username", { ascending: true })
      .range(from, to);

    if (q) listQb = listQb.ilike("username", `%${q}%`);
    if (statusFilter !== "all") listQb = listQb.eq("status", statusFilter);

    const { data: rows, error: listErr } = await listQb;
    if (!listErr) {
      items = ((rows || []) as any[]).map((r) => ({
        username: String(r.username ?? ""),
        panel_total_amount: Number(r.panel_total_amount ?? 0),
        bracket_total_amount: Number(r.bracket_total_amount ?? 0),
        diff_amount: Number(r.diff_amount ?? 0),
        panel_cnt: Number(r.panel_cnt ?? 0),
        bracket_cnt: Number(r.bracket_cnt ?? 0),
        status: r.status as ItemStatus,
      }));
    }
  }

  const missingCount = Math.max(0, totalItems - cntMatched);

  const qsBase = {
    q: q || undefined,
    status: statusRaw !== "all" ? statusRaw : undefined,
  };

  const pageFrom = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageTo = Math.min(totalItems, (safePage - 1) * pageSize + items.length);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">
        Import Run #{run.id} ({kindLabel(run.kind)})
      </h1>

      {allApprovedOutsidePeriod && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Semua transaksi <b>Approved</b> di file berada di <b>luar periode</b> yang kamu pilih. Cek ulang{" "}
          <b>Start/End (JKT)</b> atau pastikan file export-nya benar.
          <div className="mt-1 text-xs">
            Outside: <b>{approvedOutside}</b> / Total Approved: <b>{approvedTotal}</b>
          </div>
        </div>
      )}

      {/* Summary */}
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
                  <KVRow label="Panel Approve Rows (In Period)" value={<span className="font-mono">{rowsPanelIn}</span>} valueClassName="text-right" />
                  <KVRow label="Bracket Posted Rows" value={<span className="font-mono">{rowsBracket}</span>} valueClassName="text-right" />
                  <KVRow label="Panel Approved Total (File)" value={<span className="font-mono">{approvedTotal}</span>} valueClassName="text-right" />
                  <KVRow label="Approved Outside Period" value={<span className="font-mono">{approvedOutside}</span>} valueClassName="text-right" />
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
                    valueClassName={`text-right ${
                      Math.abs(amountMissing) < 0.000001 ? "text-gray-600" : "text-amber-700 font-semibold"
                    }`}
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

      {/* Matching */}
      {canShowItems && (
        <div className="rounded border bg-white overflow-hidden">
          <div className="p-3 border-b">
            <div className="font-semibold">Matching (Sum per Username)</div>
            <div className="mt-1 text-xs text-gray-600">
              Users: <b>{totalItems}</b> • Matched: <b>{cntMatched}</b> • Missing: <b>{missingCount}</b> • Lebih Bracket:{" "}
              <b>{cntLebihBracket}</b> • Lebih Panel: <b>{cntLebihPanel}</b>
            </div>
          </div>

          {/* Filters (Submit-to-apply) */}
          <div className="p-3 border-b">
            <form className="flex flex-wrap items-center gap-2" method="GET">
              <select name="status" defaultValue={statusRaw} className="h-9 rounded border bg-white px-2 text-sm">
                <option value="all">All</option>
                <option value="matched">Matched</option>
                <option value="lebih_bracket">Lebih Bracket</option>
                <option value="lebih_panel">Lebih Panel</option>
              </select>

              <input
                name="q"
                defaultValue={q}
                placeholder="Search username..."
                className="h-9 w-[260px] rounded border px-3 text-sm"
              />

              <input type="hidden" name="page" value="1" />

              <button type="submit" className="h-9 rounded border bg-white px-4 text-sm hover:bg-gray-50">
                Submit
              </button>

              <Link
                href={buildQS({})}
                className="h-9 inline-flex items-center rounded border bg-white px-4 text-sm hover:bg-gray-50"
              >
                Clear
              </Link>

              <div className="ml-auto text-xs text-gray-600">
                Showing <b>{pageFrom}</b>-<b>{pageTo}</b> of <b>{totalItems}</b>
              </div>
            </form>
          </div>

          {/* Table (✅ table-grid biar zebra dari globals.css kena) */}
          <div className="overflow-x-auto">
            <table className="table-grid w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Username</th>
                  <th className="text-right font-semibold px-3 py-2">Panel Total</th>
                  <th className="text-right font-semibold px-3 py-2">Bracket Total</th>
                  <th className="text-right font-semibold px-3 py-2">Diff</th>
                  <th className="text-left font-semibold px-3 py-2">Status</th>
                  <th className="text-right font-semibold px-3 py-2">Panel Cnt</th>
                  <th className="text-right font-semibold px-3 py-2">Bracket Cnt</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                      No data.
                    </td>
                  </tr>
                ) : (
                  items.map((r) => (
                    <tr key={r.username} className="hover:bg-gray-50">
                      <td className="px-3 py-2">{r.username}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatAmount(r.panel_total_amount)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatAmount(r.bracket_total_amount)}</td>
                      <td
                        className={`px-3 py-2 text-right font-mono ${
                          r.diff_amount < 0 ? "text-red-600" : r.diff_amount > 0 ? "text-blue-700" : "text-gray-700"
                        }`}
                      >
                        {formatAmount(r.diff_amount)}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded border px-2 py-1 text-xs ${itemStatusTone(r.status)}`}>
                          {itemStatusLabel(r.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{r.panel_cnt}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.bracket_cnt}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination (✅ First/Last + Go) */}
          <div className="p-3 border-t flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-gray-600">
              Page <b>{safePage}</b> / <b>{totalPages}</b>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                aria-disabled={safePage <= 1}
                className={`h-9 inline-flex items-center rounded border px-3 text-sm ${
                  safePage <= 1 ? "pointer-events-none opacity-50" : "hover:bg-gray-50"
                }`}
                href={buildQS({ ...qsBase, page: "1" })}
              >
                First
              </Link>

              <Link
                aria-disabled={safePage <= 1}
                className={`h-9 inline-flex items-center rounded border px-3 text-sm ${
                  safePage <= 1 ? "pointer-events-none opacity-50" : "hover:bg-gray-50"
                }`}
                href={buildQS({ ...qsBase, page: String(Math.max(1, safePage - 1)) })}
              >
                Prev
              </Link>

              <Link
                aria-disabled={safePage >= totalPages}
                className={`h-9 inline-flex items-center rounded border px-3 text-sm ${
                  safePage >= totalPages ? "pointer-events-none opacity-50" : "hover:bg-gray-50"
                }`}
                href={buildQS({ ...qsBase, page: String(Math.min(totalPages, safePage + 1)) })}
              >
                Next
              </Link>

              <Link
                aria-disabled={safePage >= totalPages}
                className={`h-9 inline-flex items-center rounded border px-3 text-sm ${
                  safePage >= totalPages ? "pointer-events-none opacity-50" : "hover:bg-gray-50"
                }`}
                href={buildQS({ ...qsBase, page: String(totalPages) })}
              >
                Last
              </Link>

              <form method="GET" className="ml-2 flex items-center gap-2">
                {qsBase.q ? <input type="hidden" name="q" value={qsBase.q} /> : null}
                {qsBase.status ? <input type="hidden" name="status" value={qsBase.status} /> : null}

                <span className="text-xs text-gray-600">Go:</span>
                <input
                  name="page"
                  type="number"
                  min={1}
                  max={totalPages}
                  defaultValue={safePage}
                  className="h-9 w-24 rounded border px-2 text-sm"
                />
                <button type="submit" className="h-9 rounded border bg-white px-3 text-sm hover:bg-gray-50">
                  Go
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
