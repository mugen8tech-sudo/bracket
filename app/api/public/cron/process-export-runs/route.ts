// app/api/public/cron/process-export-runs/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ExportKind =
  | "deposits"
  | "withdrawals"
  | "interbank_transfers"
  | "bank_adjustments"
  | "bank_expenses"
  | "credit_adjustments";

type ExportStatus = "queued" | "processing" | "done" | "error" | "cancelled";

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

function isoToJakartaSv(x?: string | null) {
  if (!x) return "";
  return new Date(x).toLocaleString("sv-SE", {
    timeZone: "Asia/Jakarta",
    hour12: false,
  });
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function statusPretty(s: any) {
  const v = String(s || "").toLowerCase();
  if (v === "posted") return "Posted";
  if (v === "reversed") return "Reversed";
  return v || "";
}

function boolPretty(v: any) {
  return v ? "TRUE" : "FALSE";
}

function applyAutoFilter(ws: XLSX.WorkSheet) {
  const ref = ws["!ref"];
  if (!ref) return;
  ws["!autofilter"] = { ref };
}

function absMinusToPlus(v: any) {
  if (v == null) return "";
  if (typeof v === "number") return Math.abs(v);
  if (typeof v === "string") {
    const s = v.trim();
    return s.startsWith("-") ? s.slice(1) : s;
  }
  return v;
}

/** =========================
 *  Column packages (hardcoded)
 *  ========================= */

const DEPOSIT_COLS = [
  "username",
  "amount_gross",
  "fee_amount",
  "txn_at",
  "performed_at",
  "status",
  "reversed_at",
  "created_by",
] as const;

const WITHDRAWAL_COLS = [
  "username",
  "amount_gross",
  "transfer_fee_amount",
  "txn_at",
  "performed_at",
  "status",
  "reversed_at",
  "created_by",
] as const;

const INTERBANK_COLS = [
  "bank_from_id",
  "from_txn_at",
  "amount_gross",
  "transfer_fee_amount",
  "description",
  "bank_to_id",
  "to_txn_at",
  "submitted_at",
  "created_by",
] as const;

const BANK_ADJ_COLS = [
  "bank_id",
  "amount_delta",
  "description",
  "txn_at_final",
  "submitted_at",
  "created_by",
] as const;

const BANK_EXP_COLS = [
  "bank_id",
  "amount",
  "category_code",
  "description",
  "txn_at_final",
  "submitted_at",
  "created_by",
] as const;

const CREDIT_ADJ_COLS = [
  "description",
  "amount",
  "is_bonus",
  "txn_at",
  "performed_at",
  "created_by",
] as const;

const DEPOSIT_LABEL: Record<string, string> = {
  username: "Username",
  amount_gross: "Amount Gross",
  fee_amount: "Fee",
  txn_at: "Waktu Dipilih",
  performed_at: "Waktu Klik",
  status: "Status",
  reversed_at: "Waktu Reversal",
  created_by: "Oleh",
};

const WITHDRAWAL_LABEL: Record<string, string> = {
  username: "Username",
  amount_gross: "Amount Gross",
  transfer_fee_amount: "Fee",
  txn_at: "Waktu Dipilih",
  performed_at: "Waktu Klik",
  status: "Status",
  reversed_at: "Waktu Reversal",
  created_by: "Oleh",
};

const INTERBANK_LABEL: Record<string, string> = {
  bank_from_id: "Bank Asal",
  from_txn_at: "Waktu Dipilih (Asal)",
  amount_gross: "Amount Gross",
  transfer_fee_amount: "Fee",
  description: "Deskripsi",
  bank_to_id: "Bank Tujuan",
  to_txn_at: "Waktu Dipilih (Tujuan)",
  submitted_at: "Waktu Klik",
  created_by: "Oleh",
};

const BANK_ADJ_LABEL: Record<string, string> = {
  bank_id: "Adjust Bank",
  amount_delta: "Amount Adjust",
  description: "Deskripsi",
  txn_at_final: "Waktu Dipilih",
  submitted_at: "Waktu Klik",
  created_by: "Oleh",
};

const BANK_EXP_LABEL: Record<string, string> = {
  bank_id: "Expense Bank",
  amount: "Amount Expense",
  category_code: "Kategori Expense",
  description: "Deskripsi",
  txn_at_final: "Waktu Dipilih",
  submitted_at: "Waktu Klik",
  created_by: "Oleh",
};

const CREDIT_ADJ_LABEL: Record<string, string> = {
  description: "Deskripsi",
  amount: "Amount",
  is_bonus: "Bonus",
  txn_at: "Waktu Dipilih",
  performed_at: "Waktu Klik",
  created_by: "Oleh",
};

type TableName =
  | "deposits"
  | "withdrawals"
  | "interbank_transfers"
  | "bank_adjustments"
  | "bank_expenses"
  | "credit_mutations";

type FilterSpec =
  | { type: "between"; field: string }
  | { type: "between_or"; fields: [string, string] };

function specForKind(kind: ExportKind) {
  if (kind === "withdrawals") {
    return {
      table: "withdrawals" as TableName,
      sheetName: "Withdrawals",
      filePrefix: "withdrawals_export_",
      cols: [...WITHDRAWAL_COLS] as string[],
      label: WITHDRAWAL_LABEL,
      filter: { type: "between", field: "txn_at" } as FilterSpec, // Waktu Dipilih
      orderField: "performed_at", // Waktu Klik
      kindFilter: null as null | { column: string; value: string },
    };
  }

  if (kind === "interbank_transfers") {
    return {
      table: "interbank_transfers" as TableName,
      sheetName: "Interbank Transfers",
      filePrefix: "interbank_transfers_export_",
      cols: [...INTERBANK_COLS] as string[],
      label: INTERBANK_LABEL,
      // Waktu Dipilih untuk TT ada 2 (Asal/Tujuan). Period dianggap "yang mana saja" (OR).
      filter: { type: "between_or", fields: ["from_txn_at", "to_txn_at"] } as FilterSpec,
      orderField: "submitted_at", // Waktu Klik
      kindFilter: null as null | { column: string; value: string },
    };
  }

  if (kind === "bank_adjustments") {
    return {
      table: "bank_adjustments" as TableName,
      sheetName: "Bank Adjustments",
      filePrefix: "bank_adjustments_export_",
      cols: [...BANK_ADJ_COLS] as string[],
      label: BANK_ADJ_LABEL,
      filter: { type: "between", field: "txn_at_final" } as FilterSpec, // Waktu Dipilih
      orderField: "submitted_at", // Waktu Klik
      kindFilter: null as null | { column: string; value: string },
    };
  }

  if (kind === "bank_expenses") {
    return {
      table: "bank_expenses" as TableName,
      sheetName: "Bank Expenses",
      filePrefix: "bank_expenses_export_",
      cols: [...BANK_EXP_COLS] as string[],
      label: BANK_EXP_LABEL,
      filter: { type: "between", field: "txn_at_final" } as FilterSpec, // Waktu Dipilih
      orderField: "submitted_at", // Waktu Klik
      kindFilter: null as null | { column: string; value: string },
    };
  }

  if (kind === "credit_adjustments") {
    return {
      table: "credit_mutations" as TableName,
      sheetName: "Credit Adjustments",
      filePrefix: "credit_adjustments_export_",
      cols: [...CREDIT_ADJ_COLS] as string[],
      label: CREDIT_ADJ_LABEL,
      filter: { type: "between", field: "txn_at" } as FilterSpec, // Waktu Dipilih
      orderField: "performed_at", // Waktu Klik
      kindFilter: { column: "kind", value: "ADJUSTMENT_CREDIT" } as { column: string; value: string },
    };
  }

  // default: deposits
  return {
    table: "deposits" as TableName,
    sheetName: "Deposits",
    filePrefix: "deposits_export_",
    cols: [...DEPOSIT_COLS] as string[],
    label: DEPOSIT_LABEL,
    filter: { type: "between", field: "txn_at" } as FilterSpec, // Waktu Dipilih
    orderField: "performed_at", // Waktu Klik
    kindFilter: null as null | { column: string; value: string },
  };
}

/**
 * IMPORTANT:
 * Query builder Supabase + dynamic filters kadang bikin TS "Type instantiation is excessively deep".
 * Jadi di sini sengaja pakai `any` biar build aman.
 */
async function fetchAll(args: {
  table: TableName;
  tenant_id: string;
  startIso: string;
  endIso: string;
  selectCols: string[];
  filter: FilterSpec;
  orderField: string;
  kindFilter: null | { column: string; value: string };
}) {
  const pageSize = 1000;
  let offset = 0;
  const out: any[] = [];

  // pastikan field untuk filter & order selalu ikut ke select (aman untuk PostgREST)
  const colsForQuery = Array.from(
    new Set(
      args.selectCols.concat(
        args.filter.type === "between" ? [args.filter.field] : [args.filter.fields[0], args.filter.fields[1]],
        [args.orderField],
      ),
    ),
  );
  const sel = colsForQuery.join(", ");

  const sb: any = supabaseAdmin as any;

  while (true) {
    let q: any = sb.from(args.table).select(sel).eq("tenant_id", args.tenant_id);

    // filter by Waktu Dipilih (period_start_at / period_end_at)
    if (args.filter.type === "between") {
      q = q.gte(args.filter.field, args.startIso).lte(args.filter.field, args.endIso);
    } else {
      const [a, b] = args.filter.fields;
      // OR: (a between) OR (b between)
      // PostgREST: or=(and(a.gte.x,a.lte.y),and(b.gte.x,b.lte.y))
      q = q.or(
        `and(${a}.gte.${args.startIso},${a}.lte.${args.endIso}),and(${b}.gte.${args.startIso},${b}.lte.${args.endIso})`,
      );
    }

    if (args.kindFilter) {
      q = q.eq(args.kindFilter.column, args.kindFilter.value);
    }

    // ✅ sort by Waktu Klik (newest first)
    q = q
      .order(args.orderField, { ascending: false })
      // tie-breaker biar stabil kalau timestamp sama
      .order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = (data || []) as any[];
    out.push(...rows);

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return out;
}

async function loadCreatorMap(userIds: string[]) {
  const map: Record<string, string> = {};
  const uniq = Array.from(new Set(userIds.filter(Boolean)));

  for (const part of chunk(uniq, 200)) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", part);

    if (error) throw new Error(error.message);

    for (const r of (data || []) as any[]) {
      if (r?.user_id) map[String(r.user_id)] = String(r.full_name || r.user_id);
    }
  }

  return map;
}

async function loadBankLabelMap(bankIds: number[]) {
  const map: Record<number, string> = {};
  const uniq = Array.from(new Set(bankIds.filter((x) => Number.isFinite(x))));

  for (const part of chunk(uniq, 200)) {
    const { data, error } = await supabaseAdmin
      .from("banks")
      .select("id, bank_code, account_name, account_no")
      .in("id", part);

    if (error) throw new Error(error.message);

    for (const b of (data || []) as any[]) {
      const id = Number(b?.id);
      if (!Number.isFinite(id)) continue;

      const code = String(b?.bank_code || "");
      const name = String(b?.account_name || "");
      const no = String(b?.account_no || "");

      map[id] = `[${code}] ${name} - ${no}`.trim();
    }
  }

  return map;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return bad("Unauthorized", 401);

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(5, Number(url.searchParams.get("limit") || 1)));

  const runIdParam = url.searchParams.get("run_id");
  const runId = runIdParam ? Number(runIdParam) : null;

  let runs: any[] = [];

  if (runId && Number.isFinite(runId)) {
    const { data, error } = await supabaseAdmin
      .from("export_runs")
      .select("id, tenant_id, kind, status, period_start_at, period_end_at, selected_columns, filters")
      .eq("id", runId)
      .eq("status", "queued")
      .limit(1);

    if (error) return bad(error.message, 500);
    runs = (data || []) as any[];
  } else {
    const { data, error } = await supabaseAdmin
      .from("export_runs")
      .select("id, tenant_id, kind, status, period_start_at, period_end_at, selected_columns, filters")
      .eq("status", "queued")
      .order("requested_at", { ascending: true })
      .limit(limit * 3);

    if (error) return bad(error.message, 500);
    runs = (data || []) as any[];
  }

  const processed: any[] = [];

  for (const run of runs) {
    if (processed.length >= limit) break;

    // claim (atomic-ish)
    const claim = await supabaseAdmin
      .from("export_runs")
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
      const kind = String(run.kind || "") as ExportKind;
      const allowedKinds = new Set<ExportKind>([
        "deposits",
        "withdrawals",
        "interbank_transfers",
        "bank_adjustments",
        "bank_expenses",
        "credit_adjustments",
      ]);
      if (!allowedKinds.has(kind)) throw new Error(`Unsupported kind: ${String(run.kind)}`);

      const tenant_id = String(run.tenant_id);
      const startIso = String(run.period_start_at);
      const endIso = String(run.period_end_at);

      const spec = specForKind(kind);

      const rows = await fetchAll({
        table: spec.table,
        tenant_id,
        startIso,
        endIso,
        selectCols: spec.cols,
        filter: spec.filter,
        orderField: spec.orderField,
        kindFilter: spec.kindFilter,
      });

      // map creator
      const creatorMap = await loadCreatorMap(
        rows.map((r: any) => String(r.created_by || "")).filter(Boolean),
      );

      // map bank labels if needed
      let bankMap: Record<number, string> = {};
      if (kind === "interbank_transfers") {
        bankMap = await loadBankLabelMap(
          rows.flatMap((r: any) => [Number(r.bank_from_id), Number(r.bank_to_id)]),
        );
      } else if (kind === "bank_adjustments" || kind === "bank_expenses") {
        bankMap = await loadBankLabelMap(rows.map((r: any) => Number(r.bank_id)));
      }

      // build header
      const header = spec.cols.map((k: string) => spec.label[k] ?? k);

      // build body
      const body = rows.map((r: any) =>
        spec.cols.map((k: string) => {
          // datetime formatting (JKT)
          if (k === "txn_at") return isoToJakartaSv(r.txn_at);
          if (k === "performed_at") return isoToJakartaSv(r.performed_at);
          if (k === "reversed_at") return isoToJakartaSv(r.reversed_at);
          if (k === "from_txn_at") return isoToJakartaSv(r.from_txn_at);
          if (k === "to_txn_at") return isoToJakartaSv(r.to_txn_at);
          if (k === "submitted_at") return isoToJakartaSv(r.submitted_at);
          if (k === "txn_at_final") return isoToJakartaSv(r.txn_at_final);

          // pretty
          if (k === "status") return statusPretty(r.status);

          // created_by -> name
          if (k === "created_by") {
            const uid = String(r.created_by || "");
            return creatorMap[uid] ?? uid;
          }

          // bank id -> label
          if (k === "bank_from_id" || k === "bank_to_id") {
            const id = Number(r?.[k]);
            return bankMap[id] ?? (Number.isFinite(id) ? String(id) : "");
          }
          if (k === "bank_id") {
            const id = Number(r?.bank_id);
            return bankMap[id] ?? (Number.isFinite(id) ? String(id) : "");
          }

          // normalize expense amount to + (abs)
          if (kind === "bank_expenses" && k === "amount") return absMinusToPlus(r.amount);

          // credit bonus boolean
          if (kind === "credit_adjustments" && k === "is_bonus") return boolPretty(r.is_bonus);

          // safe fallback
          return r?.[k] ?? "";
        }),
      );

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
      applyAutoFilter(ws);
      XLSX.utils.book_append_sheet(wb, ws, spec.sheetName);

      const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

      // filename + storage_path
      const stamp = new Date()
        .toLocaleString("sv-SE", { timeZone: "Asia/Jakarta", hour12: false })
        .replace(/[: ]/g, "")
        .replace(/-/g, "");
      const fileName = `${spec.filePrefix}${stamp}.xlsx`;
      const storage_path = `${tenant_id}/export_runs/${run.id}/${fileName}`;

      const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

      // NOTE: Supabase Storage di Node aman pakai Uint8Array (hindari Blob typing error)
      const uploadBytes = new Uint8Array(buf);

      const up = await supabaseAdmin.storage
        .from("import_exports")
        .upload(storage_path, uploadBytes, {
          upsert: true,
          contentType: mime,
        });

      if (up.error) throw new Error(up.error.message);

      const { error: uErr } = await supabaseAdmin
        .from("export_runs")
        .update({
          status: "done" as ExportStatus,
          finished_at: new Date().toISOString(),
          storage_path,
          file_name: fileName,
          rows_total: rows.length,
          error_message: null,
        })
        .eq("id", run.id);

      if (uErr) throw new Error(uErr.message);

      processed.push({ id: run.id, status: "done", rows: rows.length, file: fileName });
    } catch (e: any) {
      await supabaseAdmin
        .from("export_runs")
        .update({
          status: "error" as ExportStatus,
          finished_at: new Date().toISOString(),
          error_message: String(e?.message || e),
        })
        .eq("id", run.id);

      processed.push({ id: run.id, status: "error", error: String(e?.message || e) });
    }
  }

  return ok({
    ok: true,
    processed,
    ts: new Date().toISOString(),
  });
}
