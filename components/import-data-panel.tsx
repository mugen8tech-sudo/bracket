"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type AppRole = "admin" | "cs" | "cs_dp" | "cs_wd" | "operator" | "viewer";
type AnyRole = AppRole | "other";

function normalizeRole(r?: string | null): AnyRole {
  const v = (r || "").toLowerCase();
  if (v === "admin") return "admin";
  if (v === "cs" || v === "assops") return "cs";
  if (v === "cs_dp") return "cs_dp";
  if (v === "cs_wd") return "cs_wd";
  if (v === "operator") return "operator";
  if (v === "viewer" || v === "agent") return "viewer";
  return "other";
}

type ImportMode = "deposits" | "withdrawals" | "both";
type Kind = "deposits" | "withdrawals";

type SheetData = {
  headers: string[];
  rows: Record<string, any>[];
  sheetName: string;
};

type ColumnMapping = {
  usernameCol: string;
  amountCol: string;
  actionCol: string;
  approveAtCol: string;
};

type ParsedRow = {
  idx: number; // 1-based row number in data array
  usernameRaw: any;
  username: string;
  amountRaw: any;
  amount: number | null;
  actionRaw: any;
  approved: boolean;
  approveAtRaw: any;
  approveAtJakarta: string | null; // "YYYY-MM-DD HH:mm:ss" in Asia/Jakarta
  approveAtUtcMs: number | null;
  issues: string[];
  raw: Record<string, any>;
};

type SupaTxn = {
  id: number;
  username: string;
  amount_gross: number;
  txn_at: string; // ISO
  status: "posted" | "reversed";
};

type MatchStatus =
  | "MATCHED"
  | "NOT_FOUND"
  | "IGNORED_NOT_APPROVED"
  | "INVALID_ROW";

type MatchRow = {
  kind: Kind;
  exportRow: ParsedRow;
  status: MatchStatus;
  matched?: SupaTxn | null;
  suggestion?: {
    reason: "TIME_MISMATCH" | "AMOUNT_MISMATCH" | "FOUND_OTHER";
    candidateId?: number;
    candidateTxnAtJakarta?: string;
    diffMinutes?: number;
    note?: string;
  };
};

function normHeader(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function pickHeader(headers: string[], synonyms: string[]): string | "" {
  const H = headers.map((h) => ({ h, n: normHeader(h) }));
  const syn = synonyms.map(normHeader);
  for (const s of syn) {
    const hit = H.find((x) => x.n === s);
    if (hit) return hit.h;
  }
  // fallback: contains
  for (const s of syn) {
    const hit = H.find((x) => x.n.includes(s));
    if (hit) return hit.h;
  }
  return "";
}

function parseAmount(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Panel export biasanya pakai format: "YYYY-MM-DD HH:mm:ss" (tanpa timezone).
 * Kita anggap itu adalah waktu Asia/Jakarta, lalu convert ke UTC ms.
 */
function jakartaLocalStrToUtcMs(s: string): number | null {
  const m = String(s)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const sec = Number(m[6]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(sec)
  )
    return null;

  // Asia/Jakarta = UTC+7 → UTC = local - 7 hours
  const utcMs = Date.UTC(year, month - 1, day, hour - 7, minute, sec, 0);
  return Number.isFinite(utcMs) ? utcMs : null;
}

function formatJakartaFromISO(iso: string): string {
  // sv-SE gives "YYYY-MM-DD HH:mm:ss" (24h)
  return new Date(iso).toLocaleString("sv-SE", {
    timeZone: "Asia/Jakarta",
    hour12: false,
  });
}

function formatJakartaFromUtcMs(ms: number): string {
  return new Date(ms).toLocaleString("sv-SE", {
    timeZone: "Asia/Jakarta",
    hour12: false,
  });
}

function normalizeUsername(s: any) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

function isApproved(actionVal: any): boolean {
  const s = String(actionVal ?? "").trim().toLowerCase();
  if (!s) return false;
  // Rule utama user: Action = Approved. Kita bikin agak tolerant agar tidak fragile.
  if (s === "approved") return true;
  if (s.startsWith("approved")) return true;
  if (s === "approve") return true;
  if (s === "success") return true;
  return false;
}

const SYN_USERNAME = [
  "Login ID",
  "LoginID",
  "User ID",
  "UserID",
  "Username",
  "User",
  "Member",
  "Member ID",
  "MemberID",
];
const SYN_AMOUNT = [
  "Amount",
  "Deposit Amount",
  "Withdraw Amount",
  "Gross Amount",
  "Nominal",
];
const SYN_ACTION = [
  "Action",
  "Status",
  "Approval",
  "Approval Status",
  "Result",
];
const SYN_APPROVE_AT = [
  "Approve Date",
  "ApproveDate",
  "Approved Date",
  "ApprovedDate",
  "Approve Time",
  "Approved Time",
  "Approve At",
  "Approved At",
  "Approve Datetime",
  "ApproveDatetime",
  "ApprovedDatetime",
];

async function readXlsx(file: File): Promise<SheetData> {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const headerRows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: "",
  }) as any[][];
  const headers = (headerRows?.[0] ?? []).map((x) => String(x ?? "").trim());
  const rows = XLSX.utils.sheet_to_json(ws, {
    raw: false,
    defval: "",
  }) as Record<string, any>[];
  return { headers, rows, sheetName };
}

function buildDefaultMapping(headers: string[], _kind: Kind): ColumnMapping {
  const usernameCol = pickHeader(headers, SYN_USERNAME);
  const amountCol = pickHeader(headers, SYN_AMOUNT);
  const actionCol = pickHeader(headers, SYN_ACTION);
  const approveAtCol = pickHeader(headers, SYN_APPROVE_AT);

  return {
    usernameCol,
    amountCol,
    actionCol,
    approveAtCol,
  };
}

function parseRows(sheet: SheetData, mapping: ColumnMapping): ParsedRow[] {
  const out: ParsedRow[] = [];

  for (let i = 0; i < (sheet.rows ?? []).length; i++) {
    const raw = sheet.rows[i] || {};
    const issues: string[] = [];

    const usernameRaw = raw[mapping.usernameCol];
    const username = normalizeUsername(usernameRaw);
    if (!username) issues.push("username kosong");

    const amountRaw = raw[mapping.amountCol];
    const amount = parseAmount(amountRaw);
    if (amount === null) issues.push("amount invalid");

    const actionRaw = raw[mapping.actionCol];
    const approved = isApproved(actionRaw);

    const approveAtRaw = raw[mapping.approveAtCol];
    const approveAtUtcMs = jakartaLocalStrToUtcMs(String(approveAtRaw ?? ""));
    const approveAtJakarta =
      approveAtUtcMs != null ? formatJakartaFromUtcMs(approveAtUtcMs) : null;
    if (!approveAtJakarta) issues.push("approve date invalid");

    out.push({
      idx: i + 1,
      usernameRaw,
      username,
      amountRaw,
      amount,
      actionRaw,
      approved,
      approveAtRaw,
      approveAtJakarta,
      approveAtUtcMs,
      issues,
      raw,
    });
  }
  return out;
}

async function fetchAllTxns(
  supabase: ReturnType<typeof supabaseBrowser>,
  kind: Kind,
  minIso: string,
  maxIso: string,
): Promise<SupaTxn[]> {
  const table = kind;
  const pageSize = 1000;
  let from = 0;
  const all: SupaTxn[] = [];

  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from(table)
      .select("id, username, amount_gross, txn_at, status")
      .gte("txn_at", minIso)
      .lte("txn_at", maxIso)
      .eq("status", "posted")
      .order("txn_at", { ascending: false })
      .range(from, to);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as SupaTxn[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

function buildIndexes(txns: SupaTxn[]) {
  const byKey = new Map<string, SupaTxn[]>();
  const byUserAmount = new Map<string, SupaTxn[]>();
  const byUserTime = new Map<string, SupaTxn[]>();

  for (const t of txns) {
    const u = normalizeUsername(t.username);
    const amt = Number(t.amount_gross || 0);
    const jkt = formatJakartaFromISO(t.txn_at);
    const k = `${u}|${amt}|${jkt}`;
    const kua = `${u}|${amt}`;
    const kut = `${u}|${jkt}`;

    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(t);

    if (!byUserAmount.has(kua)) byUserAmount.set(kua, []);
    byUserAmount.get(kua)!.push(t);

    if (!byUserTime.has(kut)) byUserTime.set(kut, []);
    byUserTime.get(kut)!.push(t);
  }

  return { byKey, byUserAmount, byUserTime };
}

function matchRows(kind: Kind, parsed: ParsedRow[], txns: SupaTxn[]): MatchRow[] {
  const { byKey, byUserAmount, byUserTime } = buildIndexes(txns);

  // supaya bisa "pop" tanpa mempengaruhi sumber map, kita clone array.
  const cloneMap = (m: Map<string, SupaTxn[]>) => {
    const out = new Map<string, SupaTxn[]>();
    for (const [k, v] of m.entries()) out.set(k, [...v]);
    return out;
  };
  const keyMap = cloneMap(byKey);

  const res: MatchRow[] = [];

  for (const r of parsed) {
    if (!r.approved) {
      res.push({ kind, exportRow: r, status: "IGNORED_NOT_APPROVED" });
      continue;
    }
    if (r.issues.length > 0 || r.amount == null || !r.approveAtJakarta) {
      res.push({ kind, exportRow: r, status: "INVALID_ROW" });
      continue;
    }

    const u = r.username;
    const amt = Number(r.amount);
    const jkt = r.approveAtJakarta;
    const k = `${u}|${amt}|${jkt}`;

    const list = keyMap.get(k) ?? [];
    if (list.length > 0) {
      const matched = list.shift()!;
      keyMap.set(k, list);
      res.push({ kind, exportRow: r, status: "MATCHED", matched });
      continue;
    }

    // Suggestions
    const approveMs = r.approveAtUtcMs ?? null;
    const uaKey = `${u}|${amt}`;
    const uaList = byUserAmount.get(uaKey) ?? [];
    if (uaList.length > 0 && approveMs != null) {
      let best: { t: SupaTxn; diff: number } | null = null;
      for (const t of uaList) {
        const diff = Math.abs(approveMs - Date.parse(t.txn_at));
        if (!best || diff < best.diff) best = { t, diff };
      }
      const diffMin = best ? Math.round(best.diff / 60000) : undefined;
      res.push({
        kind,
        exportRow: r,
        status: "NOT_FOUND",
        suggestion: best
          ? {
              reason: "TIME_MISMATCH",
              candidateId: best.t.id,
              candidateTxnAtJakarta: formatJakartaFromISO(best.t.txn_at),
              diffMinutes: diffMin,
              note: "Username & amount sama, tapi approve date berbeda.",
            }
          : undefined,
      });
      continue;
    }

    const utKey = `${u}|${jkt}`;
    const utList = byUserTime.get(utKey) ?? [];
    if (utList.length > 0) {
      let best: { t: SupaTxn; diff: number } | null = null;
      for (const t of utList) {
        const diff = Math.abs(Number(t.amount_gross || 0) - amt);
        if (!best || diff < best.diff) best = { t, diff };
      }
      res.push({
        kind,
        exportRow: r,
        status: "NOT_FOUND",
        suggestion: best
          ? {
              reason: "AMOUNT_MISMATCH",
              candidateId: best.t.id,
              candidateTxnAtJakarta: formatJakartaFromISO(best.t.txn_at),
              note: `Username & approve date sama, tapi amount beda (selisih ${formatAmount(best.diff)}).`,
            }
          : undefined,
      });
      continue;
    }

    res.push({ kind, exportRow: r, status: "NOT_FOUND" });
  }

  return res;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border bg-white p-4">
      <div className="font-semibold mb-3">{title}</div>
      {children}
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "green" | "red" | "gray" | "amber";
}) {
  const cls =
    tone === "green"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "red"
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : tone === "amber"
          ? "bg-amber-50 text-amber-800 border-amber-200"
          : "bg-gray-50 text-gray-700 border-gray-200";
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${cls}`}
    >
      {children}
    </span>
  );
}

type UploadBlockState = {
  file?: File | null;
  sheet?: SheetData | null;
  mapping?: ColumnMapping | null;
  parsed?: ParsedRow[] | null;
  error?: string | null;
};

function UploadBlock(props: {
  kind: Kind;
  title: string;
  state: UploadBlockState;
  setState: (fn: (prev: UploadBlockState) => UploadBlockState) => void;
}) {
  const { kind, title, state, setState } = props;

  const headers = state.sheet?.headers ?? [];

  const readyForParse =
    !!state.sheet &&
    !!state.mapping?.usernameCol &&
    !!state.mapping?.amountCol &&
    !!state.mapping?.actionCol &&
    !!state.mapping?.approveAtCol;

  useEffect(() => {
    if (!state.sheet || !state.mapping) return;
    try {
      const parsed = parseRows(state.sheet, state.mapping);
      setState((p) => ({ ...p, parsed, error: null }));
    } catch (e: any) {
      setState((p) => ({
        ...p,
        parsed: null,
        error: e?.message || "Parse error",
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.sheet,
    state.mapping?.usernameCol,
    state.mapping?.amountCol,
    state.mapping?.actionCol,
    state.mapping?.approveAtCol,
  ]);

  const counts = useMemo(() => {
    const list = state.parsed ?? [];
    const approved = list.filter((r) => r.approved).length;
    const invalid = list.filter((r) => r.approved && r.issues.length > 0).length;
    return { total: list.length, approved, invalid };
  }, [state.parsed]);

  return (
    <Card title={title}>
      <div className="space-y-3">
        <div className="flex flex-col gap-2">
          <input
            type="file"
            accept=".xlsx,.xls"
            className="text-sm"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setState((p) => ({
                ...p,
                file: f,
                error: null,
                sheet: null,
                mapping: null,
                parsed: null,
              }));
              try {
                const sheet = await readXlsx(f);
                const mapping = buildDefaultMapping(sheet.headers, kind);
                setState((p) => ({ ...p, sheet, mapping }));
              } catch (err: any) {
                setState((p) => ({
                  ...p,
                  error: err?.message || "Gagal baca file",
                }));
              }
            }}
          />
          {state.sheet && (
            <div className="text-xs text-gray-600">
              Sheet: <span className="font-mono">{state.sheet.sheetName}</span>{" "}
              • Rows: {counts.total}
              {counts.approved > 0 ? ` • Approved: ${counts.approved}` : ""}
              {counts.invalid > 0 ? ` • Invalid(approved): ${counts.invalid}` : ""}
            </div>
          )}
          {state.error && <div className="text-sm text-rose-700">{state.error}</div>}
        </div>

        {state.sheet && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Column → Login ID / Username
              </label>
              <select
                className="w-full rounded border px-2 py-2 text-sm"
                value={state.mapping?.usernameCol ?? ""}
                onChange={(e) =>
                  setState((p) => ({
                    ...p,
                    mapping: {
                      ...(p.mapping as ColumnMapping),
                      usernameCol: e.target.value,
                    },
                  }))
                }
              >
                <option value="">-- pilih kolom --</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Column → Amount
              </label>
              <select
                className="w-full rounded border px-2 py-2 text-sm"
                value={state.mapping?.amountCol ?? ""}
                onChange={(e) =>
                  setState((p) => ({
                    ...p,
                    mapping: {
                      ...(p.mapping as ColumnMapping),
                      amountCol: e.target.value,
                    },
                  }))
                }
              >
                <option value="">-- pilih kolom --</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Column → Action / Status
              </label>
              <select
                className="w-full rounded border px-2 py-2 text-sm"
                value={state.mapping?.actionCol ?? ""}
                onChange={(e) =>
                  setState((p) => ({
                    ...p,
                    mapping: {
                      ...(p.mapping as ColumnMapping),
                      actionCol: e.target.value,
                    },
                  }))
                }
              >
                <option value="">-- pilih kolom --</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <div className="text-[11px] text-gray-500 mt-1">
                Rule: hanya baris dengan <span className="font-mono">Approved</span>{" "}
                yang diproses.
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Column → Approve Date
              </label>
              <select
                className="w-full rounded border px-2 py-2 text-sm"
                value={state.mapping?.approveAtCol ?? ""}
                onChange={(e) =>
                  setState((p) => ({
                    ...p,
                    mapping: {
                      ...(p.mapping as ColumnMapping),
                      approveAtCol: e.target.value,
                    },
                  }))
                }
              >
                <option value="">-- pilih kolom --</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <div className="text-[11px] text-gray-500 mt-1">
                Approve Date dianggap waktu <b>Asia/Jakarta</b>, lalu dicocokkan
                ke <span className="font-mono">txn_at</span> (posted).
              </div>
            </div>
          </div>
        )}

        {state.parsed && state.parsed.length > 0 && (
          <div className="rounded border">
            <div className="px-3 py-2 text-xs text-gray-600 bg-gray-50 border-b flex items-center justify-between">
              <span>Preview (max 5 rows)</span>
              {readyForParse ? (
                <Badge tone="green">Mapping OK</Badge>
              ) : (
                <Badge tone="amber">Mapping belum lengkap</Badge>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-600">
                    <th className="text-left px-3 py-2">#</th>
                    <th className="text-left px-3 py-2">username</th>
                    <th className="text-right px-3 py-2">amount</th>
                    <th className="text-left px-3 py-2">approve(jkt)</th>
                    <th className="text-left px-3 py-2">action</th>
                    <th className="text-left px-3 py-2">issues</th>
                  </tr>
                </thead>
                <tbody>
                  {state.parsed.slice(0, 5).map((r) => (
                    <tr key={r.idx} className="border-t">
                      <td className="px-3 py-2 text-gray-500">{r.idx}</td>
                      <td className="px-3 py-2 font-mono">{r.username}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {r.amount == null ? "-" : formatAmount(r.amount)}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {r.approveAtJakarta ?? "-"}
                      </td>
                      <td className="px-3 py-2">{String(r.actionRaw ?? "")}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {r.issues.join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function ResultsTable({ title, rows }: { title: string; rows: MatchRow[] }) {
  const [view, setView] = useState<
    "ALL" | "UNMATCHED" | "MATCHED" | "IGNORED" | "INVALID"
  >("ALL");

  // Search: confirm-to-apply (Enter/Submit)
  const [qInput, setQInput] = useState("");
  const [qApplied, setQApplied] = useState("");
  const applySearch = () => setQApplied(qInput.trim().toLowerCase());

  const filtered = useMemo(() => {
    let list = rows;
    if (view === "UNMATCHED") list = list.filter((r) => r.status === "NOT_FOUND");
    if (view === "MATCHED") list = list.filter((r) => r.status === "MATCHED");
    if (view === "IGNORED")
      list = list.filter((r) => r.status === "IGNORED_NOT_APPROVED");
    if (view === "INVALID") list = list.filter((r) => r.status === "INVALID_ROW");
    if (qApplied)
      list = list.filter((r) => (r.exportRow.username || "").includes(qApplied));
    return list;
  }, [rows, view, qApplied]);

  const summary = useMemo(() => {
    const total = rows.length;
    const matched = rows.filter((r) => r.status === "MATCHED").length;
    const notFound = rows.filter((r) => r.status === "NOT_FOUND").length;
    const ignored = rows.filter((r) => r.status === "IGNORED_NOT_APPROVED").length;
    const invalid = rows.filter((r) => r.status === "INVALID_ROW").length;
    return { total, matched, notFound, ignored, invalid };
  }, [rows]);

  return (
    <Card title={title}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="gray">Total: {summary.total}</Badge>
          <Badge tone="green">Matched: {summary.matched}</Badge>
          <Badge tone="red">Not found: {summary.notFound}</Badge>
          <Badge tone="gray">Ignored: {summary.ignored}</Badge>
          <Badge tone="amber">Invalid: {summary.invalid}</Badge>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">View</label>
            <select
              className="rounded border px-2 py-2 text-sm"
              value={view}
              onChange={(e) => setView(e.target.value as any)}
            >
              <option value="ALL">All</option>
              <option value="UNMATCHED">Unmatched</option>
              <option value="MATCHED">Matched</option>
              <option value="IGNORED">Ignored</option>
              <option value="INVALID">Invalid</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              className="rounded border px-3 py-2 text-sm w-[220px]"
              placeholder="Search username…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applySearch();
              }}
            />
            <button
              type="button"
              onClick={applySearch}
              className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
            >
              Submit
            </button>
            {qApplied && (
              <button
                type="button"
                onClick={() => {
                  setQInput("");
                  setQApplied("");
                }}
                className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto rounded border">
          <table className="table-grid">
            <thead>
              <tr>
                <th className="text-left">#</th>
                <th className="text-left">Username</th>
                <th className="text-right">Amount</th>
                <th className="text-left">Approve Date (JKT)</th>
                <th className="text-left">Status</th>
                <th className="text-left">Matched ID</th>
                <th className="text-left">Supabase txn_at (JKT)</th>
                <th className="text-left">Suggestion</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const tone =
                  r.status === "MATCHED"
                    ? "green"
                    : r.status === "NOT_FOUND"
                      ? "red"
                      : r.status === "INVALID_ROW"
                        ? "amber"
                        : "gray";
                return (
                  <tr key={`${r.kind}-${r.exportRow.idx}-${i}`}>
                    <td className="mono">{r.exportRow.idx}</td>
                    <td className="mono">{r.exportRow.username}</td>
                    <td className="t-right mono">
                      {r.exportRow.amount == null
                        ? "-"
                        : formatAmount(r.exportRow.amount)}
                    </td>
                    <td className="mono">{r.exportRow.approveAtJakarta ?? "-"}</td>
                    <td>
                      <Badge tone={tone as any}>{r.status}</Badge>
                    </td>
                    <td className="mono">{r.matched?.id ?? "-"}</td>
                    <td className="mono">
                      {r.matched ? formatJakartaFromISO(r.matched.txn_at) : "-"}
                    </td>
                    <td className="text-xs text-gray-700">
                      {r.suggestion ? (
                        <div className="space-y-0.5">
                          <div className="font-mono">
                            {r.suggestion.reason}
                            {r.suggestion.candidateId
                              ? ` → #${r.suggestion.candidateId}`
                              : ""}
                          </div>
                          {r.suggestion.candidateTxnAtJakarta && (
                            <div className="font-mono">
                              txn_at: {r.suggestion.candidateTxnAtJakarta}
                            </div>
                          )}
                          {typeof r.suggestion.diffMinutes === "number" && (
                            <div>Δ {r.suggestion.diffMinutes} menit</div>
                          )}
                          {r.suggestion.note && <div>{r.suggestion.note}</div>}
                        </div>
                      ) : (
                        ""
                      )}
                      {r.status === "INVALID_ROW" &&
                        r.exportRow.issues.length > 0 && (
                          <div className="text-amber-800">
                            {r.exportRow.issues.join(", ")}
                          </div>
                        )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-sm text-gray-500 py-6">
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

export default function ImportDataPanel() {
  const supabase = supabaseBrowser();

  // Guard roles
  const [authorized, setAuthorized] = useState<"loading" | "ok" | "no">("loading");
  const [role, setRole] = useState<AnyRole>("other");

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setAuthorized("no");
        return;
      }
      const { data: prof, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .single();
      if (error) {
        console.error("load role (import panel) error:", error);
        setAuthorized("no");
        return;
      }
      const r = normalizeRole((prof as any)?.role);
      setRole(r);
      const allowed = new Set<AnyRole>(["admin", "operator", "cs", "cs_dp", "cs_wd"]);
      setAuthorized(allowed.has(r) ? "ok" : "no");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [mode, setMode] = useState<ImportMode>("deposits");

  const [depState, setDepState] = useState<UploadBlockState>({});
  const [wdState, setWdState] = useState<UploadBlockState>({});

  const [running, setRunning] = useState(false);
  const [depResults, setDepResults] = useState<MatchRow[] | null>(null);
  const [wdResults, setWdResults] = useState<MatchRow[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const lastRunRef = useRef(0);

  const canRunDeposits =
    !!depState.parsed &&
    !!depState.mapping?.usernameCol &&
    !!depState.mapping?.amountCol &&
    !!depState.mapping?.actionCol &&
    !!depState.mapping?.approveAtCol;

  const canRunWithdrawals =
    !!wdState.parsed &&
    !!wdState.mapping?.usernameCol &&
    !!wdState.mapping?.amountCol &&
    !!wdState.mapping?.actionCol &&
    !!wdState.mapping?.approveAtCol;

  const canRun =
    mode === "deposits"
      ? canRunDeposits
      : mode === "withdrawals"
        ? canRunWithdrawals
        : canRunDeposits && canRunWithdrawals;

  async function runMatch() {
    if (!canRun) return;
    setRunning(true);
    setRunError(null);
    const runId = Date.now();
    lastRunRef.current = runId;

    try {
      // Deposits
      if (mode === "deposits" || mode === "both") {
        const parsed = depState.parsed ?? [];
        const approved = parsed.filter((r) => r.approved && r.approveAtUtcMs != null);
        if (approved.length === 0) {
          const rows = matchRows("deposits", parsed, []);
          if (lastRunRef.current === runId) setDepResults(rows);
        } else {
          const minMs = Math.min(...approved.map((r) => r.approveAtUtcMs as number));
          const maxMs = Math.max(...approved.map((r) => r.approveAtUtcMs as number));
          const minIso = new Date(minMs - 5 * 60000).toISOString();
          const maxIso = new Date(maxMs + 5 * 60000).toISOString();

          const txns = await fetchAllTxns(supabase, "deposits", minIso, maxIso);
          const rows = matchRows("deposits", parsed, txns);
          if (lastRunRef.current === runId) setDepResults(rows);
        }
      } else {
        setDepResults(null);
      }

      // Withdrawals
      if (mode === "withdrawals" || mode === "both") {
        const parsed = wdState.parsed ?? [];
        const approved = parsed.filter((r) => r.approved && r.approveAtUtcMs != null);
        if (approved.length === 0) {
          const rows = matchRows("withdrawals", parsed, []);
          if (lastRunRef.current === runId) setWdResults(rows);
        } else {
          const minMs = Math.min(...approved.map((r) => r.approveAtUtcMs as number));
          const maxMs = Math.max(...approved.map((r) => r.approveAtUtcMs as number));
          const minIso = new Date(minMs - 5 * 60000).toISOString();
          const maxIso = new Date(maxMs + 5 * 60000).toISOString();

          const txns = await fetchAllTxns(supabase, "withdrawals", minIso, maxIso);
          const rows = matchRows("withdrawals", parsed, txns);
          if (lastRunRef.current === runId) setWdResults(rows);
        }
      } else {
        setWdResults(null);
      }
    } catch (e: any) {
      console.error(e);
      setRunError(e?.message || "Gagal menjalankan match");
    } finally {
      setRunning(false);
    }
  }

  if (authorized === "loading") return <div className="text-sm text-gray-600">Loading…</div>;

  if (authorized === "no") {
    return (
      <div className="rounded border bg-white p-4">
        <div className="font-semibold">Forbidden</div>
        <div className="text-sm text-gray-700 mt-1">
          Role kamu (<span className="font-mono">{role}</span>) tidak diizinkan mengakses halaman ini.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="Setup">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-600">Import type</label>
            <select
              className="rounded border px-3 py-2 text-sm w-[240px]"
              value={mode}
              onChange={(e) => {
                const v = e.target.value as ImportMode;
                setMode(v);
                setDepResults(null);
                setWdResults(null);
                setRunError(null);
              }}
            >
              <option value="deposits">Deposits</option>
              <option value="withdrawals">Withdrawals</option>
              <option value="both">Deposit + Withdraw</option>
            </select>
            <div className="text-[11px] text-gray-500">
              Matching rules: username ↔ <span className="font-mono">username</span>, amount ↔{" "}
              <span className="font-mono">amount_gross</span>, hanya{" "}
              <span className="font-mono">Approved</span> dan{" "}
              <span className="font-mono">status=posted</span>, approve date (JKT) ↔{" "}
              <span className="font-mono">txn_at</span>.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={runMatch}
              disabled={!canRun || running}
            >
              {running ? "Running…" : "Run Match"}
            </button>
            <button
              type="button"
              className="rounded border px-4 py-2 text-sm hover:bg-gray-50"
              onClick={() => {
                setDepResults(null);
                setWdResults(null);
                setRunError(null);
              }}
              disabled={running}
            >
              Clear Results
            </button>
          </div>
        </div>
        {runError && <div className="mt-3 text-sm text-rose-700">{runError}</div>}
      </Card>

      {(mode === "deposits" || mode === "both") && (
        <UploadBlock
          kind="deposits"
          title="Upload Export Deposits"
          state={depState}
          setState={(fn) => setDepState((p) => fn(p))}
        />
      )}

      {(mode === "withdrawals" || mode === "both") && (
        <UploadBlock
          kind="withdrawals"
          title="Upload Export Withdrawals"
          state={wdState}
          setState={(fn) => setWdState((p) => fn(p))}
        />
      )}

      {(mode === "deposits" || mode === "both") && depResults && (
        <ResultsTable title="Results: Deposits" rows={depResults} />
      )}

      {(mode === "withdrawals" || mode === "both") && wdResults && (
        <ResultsTable title="Results: Withdrawals" rows={wdResults} />
      )}
    </div>
  );
}
