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

type DetectedMapping = {
  usernameCol: string;
  amountCol: string;
  actionCol: string;
  approveAtCol: string;
};

type ParsedRow = {
  idx: number; // 1-based
  username: string;
  amount: number | null;
  approved: boolean;
  approveAtUtcMs: number | null;
  approveAtJakarta: string | null;
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

type MatchStatus = "MATCHED" | "MISSING_IN_BRACKET" | "IGNORED" | "OUTSIDE_PERIOD" | "INVALID";

type MatchRow = {
  kind: Kind;
  exportRow: ParsedRow;
  status: MatchStatus;
  matched?: SupaTxn | null;
};

type UploadState = {
  file?: File | null;
  sheet?: SheetData | null;
  mapping?: DetectedMapping | null;
  parsed?: ParsedRow[] | null;
  error?: string | null;
  mappingOk?: boolean;
};

function normHeader(s: string) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function pickHeader(headers: string[], synonyms: string[]): string | "" {
  const H = headers.map((h) => ({ h, n: normHeader(h) }));
  const syn = synonyms.map(normHeader);

  // exact
  for (const s of syn) {
    const hit = H.find((x) => x.n === s);
    if (hit) return hit.h;
  }
  // contains
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

function normalizeUsername(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

/**
 * STRICT sesuai request: Action harus persis "Approved" (case-insensitive).
 */
function isApprovedStrict(actionVal: any): boolean {
  const s = String(actionVal ?? "").trim().toLowerCase();
  return s === "approved";
}

/**
 * Panel export: "YYYY-MM-DD HH:mm:ss" (tanpa timezone).
 * Dianggap waktu Asia/Jakarta.
 * Convert ke UTC ms: UTC = local - 7 jam.
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

  if (![year, month, day, hour, minute, sec].every(Number.isFinite)) return null;

  return Date.UTC(year, month - 1, day, hour - 7, minute, sec, 0);
}

function formatJakartaFromUtcMs(ms: number): string {
  return new Date(ms).toLocaleString("sv-SE", {
    timeZone: "Asia/Jakarta",
    hour12: false,
  });
}

function formatJakartaFromISO(iso: string): string {
  return new Date(iso).toLocaleString("sv-SE", {
    timeZone: "Asia/Jakarta",
    hour12: false,
  });
}

/**
 * datetime-local input: "YYYY-MM-DDTHH:mm"
 * Dianggap Asia/Jakarta.
 */
function jakartaLocalInputToUtcMs(value: string): number | null {
  const m = String(value)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  return Date.UTC(year, month - 1, day, hour - 7, minute, 0, 0);
}

function toDatetimeLocalJakartaNow(): string {
  // buat default input (JKT) tanpa bergantung timezone OS
  const nowJkt = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }),
  );
  const y = nowJkt.getFullYear();
  const m = String(nowJkt.getMonth() + 1).padStart(2, "0");
  const d = String(nowJkt.getDate()).padStart(2, "0");
  const hh = String(nowJkt.getHours()).padStart(2, "0");
  const mm = String(nowJkt.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function toDatetimeLocalJakartaStartOfDay(): string {
  const nowJkt = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }),
  );
  const y = nowJkt.getFullYear();
  const m = String(nowJkt.getMonth() + 1).padStart(2, "0");
  const d = String(nowJkt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}T00:00`;
}

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

// Synonyms internal (tanpa dropdown UI)
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
const SYN_AMOUNT = ["Amount", "Deposit Amount", "Withdraw Amount", "Gross Amount", "Nominal"];
const SYN_ACTION = ["Action", "Status", "Approval", "Approval Status", "Result"];
const SYN_APPROVE_AT = [
  "Approve Date",
  "ApproveDate",
  "Approved Date",
  "ApprovedDate",
  "Approve Time",
  "Approved Time",
  "Approve At",
  "Approved At",
];

function detectMapping(headers: string[]): DetectedMapping {
  const usernameCol = pickHeader(headers, SYN_USERNAME);
  const amountCol = pickHeader(headers, SYN_AMOUNT);
  const actionCol = pickHeader(headers, SYN_ACTION);
  const approveAtCol = pickHeader(headers, SYN_APPROVE_AT);

  if (!usernameCol || !amountCol || !actionCol || !approveAtCol) {
    const missing: string[] = [];
    if (!usernameCol) missing.push("Login ID / User ID");
    if (!amountCol) missing.push("Amount");
    if (!actionCol) missing.push("Action");
    if (!approveAtCol) missing.push("Approve Date");
    throw new Error(`Kolom tidak ditemukan: ${missing.join(", ")}`);
  }

  return { usernameCol, amountCol, actionCol, approveAtCol };
}

function parseRows(sheet: SheetData, mapping: DetectedMapping): ParsedRow[] {
  const out: ParsedRow[] = [];

  for (let i = 0; i < (sheet.rows ?? []).length; i++) {
    const raw = sheet.rows[i] || {};
    const issues: string[] = [];

    const username = normalizeUsername(raw[mapping.usernameCol]);
    if (!username) issues.push("username kosong");

    const amount = parseAmount(raw[mapping.amountCol]);
    if (amount === null) issues.push("amount invalid");

    const approved = isApprovedStrict(raw[mapping.actionCol]);

    const approveAtUtcMs = jakartaLocalStrToUtcMs(String(raw[mapping.approveAtCol] ?? ""));
    const approveAtJakarta =
      approveAtUtcMs != null ? formatJakartaFromUtcMs(approveAtUtcMs) : null;
    if (!approveAtJakarta) issues.push("approve date invalid");

    out.push({
      idx: i + 1,
      username,
      amount,
      approved,
      approveAtUtcMs,
      approveAtJakarta,
      issues,
      raw,
    });
  }

  return out;
}

async function fetchAllTxns(
  supabase: ReturnType<typeof supabaseBrowser>,
  kind: Kind,
  startIso: string,
  endIso: string,
): Promise<SupaTxn[]> {
  const pageSize = 1000;
  let from = 0;
  const all: SupaTxn[] = [];

  for (;;) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from(kind)
      .select("id, username, amount_gross, txn_at, status")
      .eq("status", "posted")
      .gte("txn_at", startIso)
      .lte("txn_at", endIso)
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

function normAmtKey(n: number) {
  // biar 53000 == 53000.00
  return Number(n).toFixed(2);
}

function buildSupaBucket(txns: SupaTxn[]) {
  const map = new Map<string, SupaTxn[]>();
  for (const t of txns) {
    const u = normalizeUsername(t.username);
    const a = normAmtKey(Number(t.amount_gross ?? 0));
    const k = `${u}|${a}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }
  return map;
}

function matchWithinPeriod(kind: Kind, parsed: ParsedRow[], startUtcMs: number, endUtcMs: number, supaTxns: SupaTxn[]) {
  const bucket = buildSupaBucket(supaTxns);
  const bucketClone = new Map<string, SupaTxn[]>();
  for (const [k, v] of bucket.entries()) bucketClone.set(k, [...v]);

  const results: MatchRow[] = [];

  for (const r of parsed) {
    if (!r.approved) {
      results.push({ kind, exportRow: r, status: "IGNORED" });
      continue;
    }
    if (r.issues.length > 0 || r.amount == null || r.approveAtUtcMs == null) {
      results.push({ kind, exportRow: r, status: "INVALID" });
      continue;
    }
    if (r.approveAtUtcMs < startUtcMs || r.approveAtUtcMs > endUtcMs) {
      results.push({ kind, exportRow: r, status: "OUTSIDE_PERIOD" });
      continue;
    }

    const k = `${r.username}|${normAmtKey(r.amount)}`;
    const list = bucketClone.get(k) ?? [];
    if (list.length > 0) {
      const matched = list.shift()!;
      bucketClone.set(k, list);
      results.push({ kind, exportRow: r, status: "MATCHED", matched });
    } else {
      results.push({ kind, exportRow: r, status: "MISSING_IN_BRACKET" });
    }
  }

  // extras: supabase posted dalam periode tapi tidak kepakai buat match
  const extras: SupaTxn[] = [];
  for (const v of bucketClone.values()) extras.push(...v);

  return { results, extras };
}

function Badge({
  tone,
  children,
}: {
  tone: "green" | "red" | "gray" | "amber" | "blue";
  children: React.ReactNode;
}) {
  const cls =
    tone === "green"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "red"
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : tone === "amber"
          ? "bg-amber-50 text-amber-800 border-amber-200"
          : tone === "blue"
            ? "bg-sky-50 text-sky-700 border-sky-200"
            : "bg-gray-50 text-gray-700 border-gray-200";
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${cls}`}>
      {children}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border bg-white p-4">
      <div className="font-semibold mb-3">{title}</div>
      {children}
    </div>
  );
}

function UploadSimple(props: {
  title: string;
  kind: Kind;
  state: UploadState;
  setState: (fn: (prev: UploadState) => UploadState) => void;
}) {
  const { title, kind, state, setState } = props;

  const info = useMemo(() => {
    const rows = state.parsed ?? [];
    const approved = rows.filter((r) => r.approved).length;
    return { total: rows.length, approved };
  }, [state.parsed]);

  return (
    <Card title={title}>
      <div className="space-y-2">
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
              mappingOk: false,
            }));

            try {
              const sheet = await readXlsx(f);
              const mapping = detectMapping(sheet.headers);
              const parsed = parseRows(sheet, mapping);

              setState((p) => ({
                ...p,
                sheet,
                mapping,
                parsed,
                mappingOk: true,
                error: null,
              }));
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
            Sheet: <span className="font-mono">{state.sheet.sheetName}</span> • Rows:{" "}
            {info.total} • Approved: {info.approved} •{" "}
            {state.mappingOk ? <Badge tone="green">Mapping OK</Badge> : <Badge tone="amber">Mapping error</Badge>}
          </div>
        )}

        {state.mappingOk && state.mapping && (
          <div className="text-[11px] text-gray-500">
            Detected: <span className="font-mono">{state.mapping.usernameCol}</span>,{" "}
            <span className="font-mono">{state.mapping.amountCol}</span>,{" "}
            <span className="font-mono">{state.mapping.actionCol}</span>,{" "}
            <span className="font-mono">{state.mapping.approveAtCol}</span>
          </div>
        )}

        {state.error && <div className="text-sm text-rose-700">{state.error}</div>}
      </div>
    </Card>
  );
}

function ResultsTable({
  title,
  rows,
  extras,
}: {
  title: string;
  rows: MatchRow[];
  extras: SupaTxn[];
}) {
  const [view, setView] = useState<"MISSING" | "MATCHED" | "ALL">("MISSING");

  const summary = useMemo(() => {
    const totalApproved = rows.filter((r) => r.exportRow.approved).length;
    const inPeriod = rows.filter(
      (r) => r.exportRow.approved && r.status !== "OUTSIDE_PERIOD" && r.status !== "INVALID",
    ).length;
    const missing = rows.filter((r) => r.status === "MISSING_IN_BRACKET").length;
    const matched = rows.filter((r) => r.status === "MATCHED").length;
    const ignored = rows.filter((r) => r.status === "IGNORED").length;
    const outside = rows.filter((r) => r.status === "OUTSIDE_PERIOD").length;
    const invalid = rows.filter((r) => r.status === "INVALID").length;

    return { totalApproved, inPeriod, missing, matched, ignored, outside, invalid, extras: extras.length };
  }, [rows, extras]);

  const filtered = useMemo(() => {
    if (view === "MISSING") return rows.filter((r) => r.status === "MISSING_IN_BRACKET");
    if (view === "MATCHED") return rows.filter((r) => r.status === "MATCHED");
    return rows;
  }, [rows, view]);

  return (
    <Card title={title}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="blue">Approved: {summary.totalApproved}</Badge>
          <Badge tone="gray">In period: {summary.inPeriod}</Badge>
          <Badge tone="red">Missing: {summary.missing}</Badge>
          <Badge tone="green">Matched: {summary.matched}</Badge>
          <Badge tone="gray">Ignored: {summary.ignored}</Badge>
          <Badge tone="amber">Outside: {summary.outside}</Badge>
          <Badge tone="amber">Invalid: {summary.invalid}</Badge>
          <Badge tone="gray">Extra bracket: {summary.extras}</Badge>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600">View</label>
          <select
            className="rounded border px-2 py-2 text-sm"
            value={view}
            onChange={(e) => setView(e.target.value as any)}
          >
            <option value="MISSING">Missing only</option>
            <option value="MATCHED">Matched only</option>
            <option value="ALL">All (debug)</option>
          </select>
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
                <th className="text-left">Bracket ID</th>
                <th className="text-left">Bracket txn_at (JKT)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const tone =
                  r.status === "MATCHED"
                    ? "green"
                    : r.status === "MISSING_IN_BRACKET"
                      ? "red"
                      : r.status === "IGNORED"
                        ? "gray"
                        : r.status === "OUTSIDE_PERIOD"
                          ? "amber"
                          : "amber";

                return (
                  <tr key={`${r.kind}-${r.exportRow.idx}`}>
                    <td className="mono">{r.exportRow.idx}</td>
                    <td className="mono">{r.exportRow.username}</td>
                    <td className="t-right mono">
                      {r.exportRow.amount == null ? "-" : formatAmount(r.exportRow.amount)}
                    </td>
                    <td className="mono">{r.exportRow.approveAtJakarta ?? "-"}</td>
                    <td>
                      <Badge tone={tone as any}>{r.status}</Badge>
                      {r.status === "INVALID" && r.exportRow.issues.length > 0 && (
                        <div className="text-[11px] text-amber-800 mt-1">
                          {r.exportRow.issues.join(", ")}
                        </div>
                      )}
                    </td>
                    <td className="mono">{r.matched?.id ?? "-"}</td>
                    <td className="mono">
                      {r.matched ? formatJakartaFromISO(r.matched.txn_at) : "-"}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-sm text-gray-500 py-6">
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Optional: transaksi bracket yang "extra" dalam periode */}
        {extras.length > 0 && (
          <details className="rounded border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Extra in Bracket (posted dalam periode tapi tidak match ke panel)
            </summary>
            <div className="mt-3 overflow-x-auto rounded border">
              <table className="table-grid">
                <thead>
                  <tr>
                    <th className="text-left">ID</th>
                    <th className="text-left">Username</th>
                    <th className="text-right">Amount</th>
                    <th className="text-left">txn_at (JKT)</th>
                  </tr>
                </thead>
                <tbody>
                  {extras.map((t) => (
                    <tr key={t.id}>
                      <td className="mono">{t.id}</td>
                      <td className="mono">{normalizeUsername(t.username)}</td>
                      <td className="t-right mono">{formatAmount(Number(t.amount_gross ?? 0))}</td>
                      <td className="mono">{formatJakartaFromISO(t.txn_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}

export default function ImportDataPanel() {
  const supabase = supabaseBrowser();

  // Guard role (sesuai kebutuhan)
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

  // Period input (JKT)
  const [startLocal, setStartLocal] = useState<string>(toDatetimeLocalJakartaStartOfDay());
  const [endLocal, setEndLocal] = useState<string>(toDatetimeLocalJakartaNow());

  const [depState, setDepState] = useState<UploadState>({});
  const [wdState, setWdState] = useState<UploadState>({});

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const [depRows, setDepRows] = useState<MatchRow[] | null>(null);
  const [wdRows, setWdRows] = useState<MatchRow[] | null>(null);
  const [depExtras, setDepExtras] = useState<SupaTxn[]>([]);
  const [wdExtras, setWdExtras] = useState<SupaTxn[]>([]);

  const lastRunRef = useRef(0);

  const canRunDeposits = !!depState.mappingOk && !!depState.parsed;
  const canRunWithdrawals = !!wdState.mappingOk && !!wdState.parsed;

  const canRun =
    mode === "deposits"
      ? canRunDeposits
      : mode === "withdrawals"
        ? canRunWithdrawals
        : canRunDeposits && canRunWithdrawals;

  async function runMatch() {
    if (!canRun) return;

    const startUtcMs = jakartaLocalInputToUtcMs(startLocal);
    const endUtcMs = jakartaLocalInputToUtcMs(endLocal);

    if (startUtcMs == null || endUtcMs == null) {
      setRunError("Start/End period tidak valid.");
      return;
    }
    if (endUtcMs < startUtcMs) {
      setRunError("End period harus lebih besar dari Start period.");
      return;
    }

    setRunning(true);
    setRunError(null);

    const runId = Date.now();
    lastRunRef.current = runId;

    try {
      const startIso = new Date(startUtcMs).toISOString();
      // inclusive end: tambah 59 detik supaya periode menit terakhir kebawa
      const endIso = new Date(endUtcMs + 59_000).toISOString();

      if (mode === "deposits" || mode === "both") {
        const parsed = depState.parsed ?? [];
        const supa = await fetchAllTxns(supabase, "deposits", startIso, endIso);
        const { results, extras } = matchWithinPeriod("deposits", parsed, startUtcMs, endUtcMs + 59_000, supa);

        if (lastRunRef.current === runId) {
          setDepRows(results);
          setDepExtras(extras);
        }
      } else {
        setDepRows(null);
        setDepExtras([]);
      }

      if (mode === "withdrawals" || mode === "both") {
        const parsed = wdState.parsed ?? [];
        const supa = await fetchAllTxns(supabase, "withdrawals", startIso, endIso);
        const { results, extras } = matchWithinPeriod("withdrawals", parsed, startUtcMs, endUtcMs + 59_000, supa);

        if (lastRunRef.current === runId) {
          setWdRows(results);
          setWdExtras(extras);
        }
      } else {
        setWdRows(null);
        setWdExtras([]);
      }
    } catch (e: any) {
      setRunError(e?.message || "Gagal run match");
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
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-600">Import type</label>
              <select
                className="rounded border px-3 py-2 text-sm w-[260px]"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as ImportMode);
                  setDepRows(null);
                  setWdRows(null);
                  setDepExtras([]);
                  setWdExtras([]);
                  setRunError(null);
                }}
              >
                <option value="deposits">Deposits</option>
                <option value="withdrawals">Withdrawals</option>
                <option value="both">Deposit + Withdraw</option>
              </select>
              <div className="text-[11px] text-gray-500">
                Matching = <b>periode</b> (Approve Date panel & txn_at bracket harus sama-sama di range) + key{" "}
                <span className="font-mono">username + amount_gross</span>. Action harus persis{" "}
                <span className="font-mono">Approved</span>, status bracket harus{" "}
                <span className="font-mono">posted</span>.
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
                  setDepRows(null);
                  setWdRows(null);
                  setDepExtras([]);
                  setWdExtras([]);
                  setRunError(null);
                }}
                disabled={running}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Period inputs (JKT) */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Start (Asia/Jakarta)</label>
              <input
                type="datetime-local"
                className="w-full rounded border px-3 py-2 text-sm"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">End (Asia/Jakarta)</label>
              <input
                type="datetime-local"
                className="w-full rounded border px-3 py-2 text-sm"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
              />
            </div>
            <div className="text-[11px] text-gray-500 md:pt-6">
              Tip: ini dipakai untuk “request import jam sekian–sekian” agar ketahuan transaksi panel mana yang belum tercatat.
            </div>
          </div>

          {runError && <div className="text-sm text-rose-700">{runError}</div>}
        </div>
      </Card>

      {(mode === "deposits" || mode === "both") && (
        <UploadSimple
          title="Upload Export Deposits"
          kind="deposits"
          state={depState}
          setState={(fn) => setDepState((p) => fn(p))}
        />
      )}

      {(mode === "withdrawals" || mode === "both") && (
        <UploadSimple
          title="Upload Export Withdrawals"
          kind="withdrawals"
          state={wdState}
          setState={(fn) => setWdState((p) => fn(p))}
        />
      )}

      {(mode === "deposits" || mode === "both") && depRows && (
        <ResultsTable title="Results: Deposits" rows={depRows} extras={depExtras} />
      )}

      {(mode === "withdrawals" || mode === "both") && wdRows && (
        <ResultsTable title="Results: Withdrawals" rows={wdRows} extras={wdExtras} />
      )}
    </div>
  );
}
