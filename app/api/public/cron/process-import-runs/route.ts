// app/api/public/cron/process-import-runs/route.ts

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ImportKind = "deposits" | "withdrawals";
type ImportStatus = "queued" | "processing" | "done" | "error";

function ok(res: unknown) {
  return NextResponse.json(res, { status: 200 });
}
function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}

function normHeader(s: unknown) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/_/g, " ");
}

function findCol(headers: unknown[], candidates: string[]) {
  const h = headers.map(normHeader);
  const c = candidates.map((x) => normHeader(x));

  for (let i = 0; i < h.length; i++) {
    if (!h[i]) continue;
    if (c.includes(h[i])) return i;
  }
  // fallback: partial contains
  for (let i = 0; i < h.length; i++) {
    for (const want of c) {
      if (want && h[i].includes(want)) return i;
    }
  }
  return -1;
}

function parseMoneyToNumber(v: unknown) {
  if (v == null || v === "") return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;

  let s = String(v).trim();
  if (!s) return 0;

  // keep only digits, separators and minus
  s = s.replace(/[^\d,.\-]/g, "");

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  const normalizeSingleSep = (sep: "." | ",") => {
    const parts = s.split(sep);
    const last = parts[parts.length - 1] ?? "";
    // if last looks like decimals (1-2 digits) => decimal sep
    if (last.length === 1 || last.length === 2) {
      s = parts.slice(0, -1).join("") + "." + last;
    } else {
      // else thousands sep
      s = parts.join("");
    }
  };

  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastDot > lastComma) {
      // "20,000.00"
      s = s.replace(/,/g, "");
    } else {
      // "20.000,00"
      s = s.replace(/\./g, "").replace(/,/g, ".");
    }
  } else if (hasComma) normalizeSingleSep(",");
  else if (hasDot) normalizeSingleSep(".");

  const n = Number(s || 0);
  if (!Number.isFinite(n)) return 0;
  return n;
}

/**
 * RULE BARU:
 * - kalau scaleAllX1000 aktif => SCALE SEMUA AMOUNT x1000 (termasuk yang >= 1000)
 * - kalau tidak => no scale
 */
function parseMoneyToCents(v: unknown, scaleAllX1000: boolean) {
  const n0 = parseMoneyToNumber(v);
  let n = n0;

  if (scaleAllX1000 && n !== 0) n = n * 1000;

  return Math.round(n * 100);
}

function excelSerialToIsoJkt(serial: number) {
  const p = XLSX.SSF.parse_date_code(serial);
  if (!p) return "";
  const yyyy = String(p.y).padStart(4, "0");
  const mm = String(p.m).padStart(2, "0");
  const dd = String(p.d).padStart(2, "0");
  const HH = String(p.H).padStart(2, "0");
  const MM = String(p.M).padStart(2, "0");
  const SS = String(Math.floor(p.S || 0)).padStart(2, "0");
  return new Date(`${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}+07:00`).toISOString();
}

function parseApproveDateToIso(v: unknown) {
  if (v == null || v === "") return "";

  if (typeof v === "number" && Number.isFinite(v)) {
    return excelSerialToIsoJkt(v);
  }

  const s0 = String(v).trim();
  if (!s0) return "";

  // "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DDTHH:mm:ss"
  const s1 = s0.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s1)) {
    const s2 = s1.length === 16 ? `${s1}:00` : s1;
    return new Date(`${s2}+07:00`).toISOString();
  }

  // dd/MM/yyyy HH:mm:ss
  const m1 = s0.match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (m1) {
    const dd = m1[1],
      mm = m1[2],
      yyyy = m1[3];
    const HH = m1[4],
      MM = m1[5],
      SS = m1[6] ?? "00";
    return new Date(`${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}+07:00`).toISOString();
  }

  // dd-MMM-yyyy HH:mm:ss (ex: 27-Dec-2025 16:54:58)
  const m2 = s0.match(
    /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (m2) {
    const dd = String(m2[1]).padStart(2, "0");
    const monKey = String(m2[2]).toLowerCase();
    const yyyy = String(m2[3]);
    const HH = String(m2[4]);
    const MM = String(m2[5]);
    const SS = String(m2[6] ?? "00").padStart(2, "0");

    const monthMap: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const mm = monthMap[monKey];
    if (mm) return new Date(`${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}+07:00`).toISOString();
  }

  const t = Date.parse(s0);
  if (!Number.isNaN(t)) return new Date(t).toISOString();

  return "";
}

function keyUsername(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

function centsToNumber(cents: number) {
  return Math.round(cents) / 100;
}

async function fetchAllBracketRows(args: {
  tenant_id: string;
  kind: ImportKind;
  startIso: string;
  endIso: string;
}) {
  const table = args.kind;
  const pageSize = 1000;

  let offset = 0;
  let out: { username: string; amount_gross: number; txn_at: string }[] = [];

  while (true) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("username, amount_gross, txn_at")
      .eq("tenant_id", args.tenant_id)
      .eq("status", "posted")
      .gte("txn_at", args.startIso)
      .lte("txn_at", args.endIso)
      .order("txn_at", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(error.message);
    const rows = (data || []) as any[];

    for (const r of rows) {
      out.push({
        username: String(r.username ?? ""),
        amount_gross: Number(r.amount_gross ?? 0),
        txn_at: String(r.txn_at ?? ""),
      });
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return out;
}

function detectHeaderRow(matrix: any[][]) {
  // scan first N rows to find the real header row
  const maxScan = Math.min(30, matrix.length);
  const userCandidates = [
    "user name",
    "login id",
    "username",
    "user id",
    "userid",
    "member",
    "member id",
    "player",
  ];
  const netAmountCandidates = ["nett amount", "net amount"];
  const amountCandidates = [
    "amount",
    "nominal",
    "gross amount",
    "deposit amount",
    "withdraw amount",
  ];
  const actionCandidates = ["status", "action", "result"];
  const approveCandidates = [
    "approved date",
    "approve date",
    "approved time",
    "approve time",
    "date",
    "time",
  ];

  for (let r = 0; r < maxScan; r++) {
    const headers = matrix[r] || [];
    if (!headers.length) continue;

    const iUser = findCol(headers, userCandidates);
    const iNet = findCol(headers, netAmountCandidates);
    const iAmt = iNet >= 0 ? iNet : findCol(headers, amountCandidates);
    const iAct = findCol(headers, actionCandidates);
    const iApv = findCol(headers, approveCandidates);

    if (iUser >= 0 && iAmt >= 0 && iAct >= 0 && iApv >= 0) {
      return { headerRowIndex: r, iUser, iAmt, iAct, iApv };
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return bad("Unauthorized", 401);

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(5, Number(url.searchParams.get("limit") || 1)));

  const started = new Date().toISOString();
  const processed: any[] = [];

  const runIdParam = url.searchParams.get("run_id");
  const runId = runIdParam ? Number(runIdParam) : null;

  let runs: any[] = [];

  if (runId && Number.isFinite(runId)) {
    const { data, error } = await supabaseAdmin
      .from("import_runs")
      .select("id, tenant_id, kind, status, period_start_at, period_end_at, storage_path, file_name, panel_file_name")
      .eq("id", runId)
      .eq("status", "queued")
      .limit(1);

    if (error) return bad(error.message, 500);
    runs = (data || []) as any[];
  } else {
    const { data: queued, error: qErr } = await supabaseAdmin
      .from("import_runs")
      .select("id, tenant_id, kind, status, period_start_at, period_end_at, storage_path, file_name, panel_file_name")
      .eq("status", "queued")
      .order("requested_at", { ascending: true })
      .limit(limit * 3);

    if (qErr) return bad(qErr.message, 500);
    runs = (queued || []) as any[];
  }

  for (const run of runs) {
    if (processed.length >= limit) break;

    const claim = await supabaseAdmin
      .from("import_runs")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", run.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();

    if (claim.error) {
      processed.push({ id: run.id, status: "claim_error", error: claim.error.message });
      continue;
    }
    if (!claim.data) continue;

    try {
      const kind = run.kind as ImportKind;
      const tenant_id = String(run.tenant_id);
      const startIso = String(run.period_start_at);
      const endIso = String(run.period_end_at);

      const { data: blob, error: dErr } = await supabaseAdmin.storage
        .from("import_exports")
        .download(String(run.storage_path));

      if (dErr || !blob) throw new Error(dErr?.message || "Failed to download file");

      const ab = await blob.arrayBuffer();
      const wb = XLSX.read(ab, { type: "array", cellDates: false });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("No sheet found in xlsx");
      const ws = wb.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true }) as any[][];

      const hdr = detectHeaderRow(matrix);
      if (!hdr) throw new Error("Header row not found / columns not detected");

      const { headerRowIndex, iUser, iAmt, iAct, iApv } = hdr;

      // =========================================================
      // ✅ DETEKSI SCALE GLOBAL BERDASARKAN 25% DARI FILE (APPROVED)
      // Rule:
      // - jika >= 25% dari Approved rows punya amount < 1000 => scale SEMUA amount x1000
      // - selain itu => tidak scale sama sekali
      // =========================================================
      let approvedForScale = 0;
      let lt1000Count = 0;

      for (let r = headerRowIndex + 1; r < matrix.length; r++) {
        const row = matrix[r] || [];

        const act = String(row[iAct] ?? "").trim().toLowerCase();
        if (act !== "approved") continue;

        const n = parseMoneyToNumber(row[iAmt]);
        if (!(n > 0)) continue;

        approvedForScale += 1;
        if (n < 1000) lt1000Count += 1;
      }

      const pctLt1000 = approvedForScale > 0 ? lt1000Count / approvedForScale : 0;
      const scaleAllX1000 = pctLt1000 >= 0.25;

      let panelApprovedRows = 0;
      let panelApprovedRowsTotal = 0;
      let panelApprovedRowsOutside = 0;

      let panelTotalCents = 0;

      const panelAgg = new Map<string, { sumCents: number; cnt: number }>();

      for (let r = headerRowIndex + 1; r < matrix.length; r++) {
        const row = matrix[r] || [];
        const usernameKey = keyUsername(row[iUser]);
        if (!usernameKey) continue;

        const act = String(row[iAct] ?? "").trim().toLowerCase();
        if (act !== "approved") continue;

        const approveIso = parseApproveDateToIso(row[iApv]);
        if (!approveIso) continue;

        panelApprovedRowsTotal += 1;

        const inPeriod = !(approveIso < startIso || approveIso > endIso);
        if (!inPeriod) {
          panelApprovedRowsOutside += 1;
          continue;
        }

        const cents = parseMoneyToCents(row[iAmt], scaleAllX1000);

        panelApprovedRows += 1;
        panelTotalCents += cents;

        const prev = panelAgg.get(usernameKey) || { sumCents: 0, cnt: 0 };
        prev.sumCents += cents;
        prev.cnt += 1;
        panelAgg.set(usernameKey, prev);
      }

      const bracketRows = await fetchAllBracketRows({ tenant_id, kind, startIso, endIso });

      const bracketPostedRows = bracketRows.length;
      let bracketTotalCents = 0;

      const bracketAgg = new Map<string, { sumCents: number; cnt: number }>();
      for (const r of bracketRows) {
        const k = keyUsername(r.username);
        if (!k) continue;
        const cents = Math.round(Number(r.amount_gross || 0) * 100);
        bracketTotalCents += cents;

        const prev = bracketAgg.get(k) || { sumCents: 0, cnt: 0 };
        prev.sumCents += cents;
        prev.cnt += 1;
        bracketAgg.set(k, prev);
      }

      const users = new Set<string>();
      for (const k of panelAgg.keys()) users.add(k);
      for (const k of bracketAgg.keys()) users.add(k);

      const usernames = Array.from(users).sort((a, b) => a.localeCompare(b));

      let matchedUsers = 0;
      let missingUsers = 0;

      const items = usernames.map((u) => {
        const p = panelAgg.get(u) || { sumCents: 0, cnt: 0 };
        const b = bracketAgg.get(u) || { sumCents: 0, cnt: 0 };
        const diffCents = b.sumCents - p.sumCents;

        let status: string;
        if (diffCents === 0) status = "MATCHED";
        else if (diffCents > 0) status = "LEBIH_BRACKET";
        else status = "LEBIH_PANEL";

        if (status === "MATCHED") matchedUsers += 1;
        else missingUsers += 1;

        return {
          tenant_id,
          run_id: run.id,
          username: u,
          panel_total_amount: centsToNumber(p.sumCents),
          bracket_total_amount: centsToNumber(b.sumCents),
          diff_amount: centsToNumber(diffCents),
          panel_cnt: p.cnt,
          bracket_cnt: b.cnt,
          status,
        };
      });

      await supabaseAdmin.from("import_run_items").delete().eq("run_id", run.id);

      const batchSize = 500;
      for (let i = 0; i < items.length; i += batchSize) {
        const chunk = items.slice(i, i + batchSize);
        const { error: iErr } = await supabaseAdmin.from("import_run_items").insert(chunk);
        if (iErr) throw new Error(iErr.message);
      }

      const derivedFileName =
        run.file_name ||
        run.panel_file_name ||
        (run.storage_path ? String(run.storage_path).split("/").pop() : null);

      const { error: uErr } = await supabaseAdmin
        .from("import_runs")
        .update({
          status: "done" as ImportStatus,
          finished_at: new Date().toISOString(),
          users_total: usernames.length,
          matched_users: matchedUsers,
          missing_users: missingUsers,

          panel_approved_rows: panelApprovedRows,
          panel_approved_rows_total: panelApprovedRowsTotal,
          panel_approved_rows_outside: panelApprovedRowsOutside,

          bracket_posted_rows: bracketPostedRows,
          panel_total_amount: centsToNumber(panelTotalCents),
          bracket_total_amount: centsToNumber(bracketTotalCents),

          file_name: run.file_name ?? derivedFileName,
          panel_file_name: run.panel_file_name ?? derivedFileName,
        })
        .eq("id", run.id);

      if (uErr) throw new Error(uErr.message);

      processed.push({
        id: run.id,
        kind,
        users: usernames.length,
        matched: matchedUsers,
        missing: missingUsers,
        panelApprovedRows,
        bracketPostedRows,
        panelApprovedRowsTotal,
        panelApprovedRowsOutside,
        fileName: derivedFileName,
        scaleAllX1000,
        pctLt1000,
        approvedForScale,
        status: "done",
      });
    } catch (e: any) {
      await supabaseAdmin
        .from("import_runs")
        .update({
          status: "error" as ImportStatus,
          finished_at: new Date().toISOString(),
          error_message: String(e?.message || e),
        })
        .eq("id", run.id);

      processed.push({ id: run.id, status: "error", error: String(e?.message || e) });
    }
  }

  return ok({ started, processed_count: processed.length, processed });
}
