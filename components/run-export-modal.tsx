"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type ExportKind =
  | "deposits"
  | "withdrawals"
  | "interbank_transfers"
  | "bank_adjustments"
  | "bank_expenses"
  | "credit_adjustments";

type AnyRole = "admin" | "operator" | "cs" | "cs_dp" | "cs_wd" | "viewer" | "other";

function normalizeRole(r?: string | null): AnyRole {
  const v = (r || "").toLowerCase();
  if (v === "admin") return "admin";
  if (v === "operator") return "operator";
  if (v === "cs") return "cs";
  if (v === "cs_dp") return "cs_dp";
  if (v === "cs_wd") return "cs_wd";
  if (v === "viewer") return "viewer";
  return "other";
}

function todayJakartaDateStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function nowJakartaDatetimeLocalValue() {
  return new Date()
    .toLocaleString("sv-SE", { timeZone: "Asia/Jakarta", hour12: false })
    .replace(" ", "T");
}

function jktLocalToISO(v: string) {
  if (!v) return "";
  let x = v;
  if (x.length === 16) x += ":00";
  return new Date(x + "+07:00").toISOString();
}

function useSubmitGuard() {
  const lockRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const run = async <T,>(fn: () => Promise<T> | T) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setSubmitting(true);
    try {
      return await fn();
    } finally {
      setSubmitting(false);
      lockRef.current = false;
    }
  };

  return { submitting, run };
}

/** hardcoded paket kolom */
const DEPOSIT_EXPORT_COLS = [
  "username",
  "amount_gross",
  "fee_amount",
  "txn_at",
  "performed_at",
  "status",
  "reversed_at",
  "created_by",
];

const WITHDRAWAL_EXPORT_COLS = [
  "username",
  "amount_gross",
  "transfer_fee_amount",
  "txn_at",
  "performed_at",
  "status",
  "reversed_at",
  "created_by",
];

const INTERBANK_EXPORT_COLS = [
  "bank_from_id",
  "from_txn_at",
  "amount_gross",
  "transfer_fee_amount",
  "description",
  "bank_to_id",
  "to_txn_at",
  "submitted_at",
  "created_by",
];

const BANK_ADJ_EXPORT_COLS = [
  "bank_id",
  "amount_delta",
  "description",
  "txn_at_final",
  "submitted_at",
  "created_by",
];

const BANK_EXP_EXPORT_COLS = [
  "bank_id",
  "amount",
  "category_code",
  "description",
  "txn_at_final",
  "submitted_at",
  "created_by",
];

const CREDIT_ADJ_EXPORT_COLS = [
  "description",
  "amount",
  "is_bonus",
  "txn_at",
  "performed_at",
  "created_by",
];

function colsForKind(kind: ExportKind) {
  if (kind === "withdrawals") return WITHDRAWAL_EXPORT_COLS;
  if (kind === "interbank_transfers") return INTERBANK_EXPORT_COLS;
  if (kind === "bank_adjustments") return BANK_ADJ_EXPORT_COLS;
  if (kind === "bank_expenses") return BANK_EXP_EXPORT_COLS;
  if (kind === "credit_adjustments") return CREDIT_ADJ_EXPORT_COLS;
  return DEPOSIT_EXPORT_COLS;
}

export default function RunExportModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const supabase = supabaseBrowser();
  const guard = useSubmitGuard();

  const [kind, setKind] = useState<ExportKind>("deposits");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");

  const [tenantId, setTenantId] = useState<string>("");
  const [role, setRole] = useState<AnyRole>("other");
  const [authLoading, setAuthLoading] = useState(true);

  const allowed = useMemo(() => {
    return new Set<AnyRole>(["admin", "operator", "cs", "cs_dp", "cs_wd"]).has(role);
  }, [role]);

  useEffect(() => {
    if (!open) return;
    const d = todayJakartaDateStr();
    setStartLocal(`${d}T00:00:00`);
    setEndLocal(nowJakartaDatetimeLocalValue());
    setKind("deposits");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setAuthLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setRole("other");
        setTenantId("");
        setAuthLoading(false);
        return;
      }

      const { data: prof, error } = await supabase
        .from("profiles")
        .select("tenant_id, role")
        .eq("user_id", user.id)
        .single();

      if (error || !prof) {
        setRole("other");
        setTenantId("");
        setAuthLoading(false);
        return;
      }

      setTenantId(String((prof as any).tenant_id || ""));
      setRole(normalizeRole((prof as any).role));
      setAuthLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const validate = () => {
    if (!startLocal || !endLocal) return "Start/End wajib diisi.";
    const sISO = jktLocalToISO(startLocal);
    const eISO = jktLocalToISO(endLocal);
    if (!sISO || !eISO) return "Start/End tidak valid.";
    if (new Date(sISO).getTime() > new Date(eISO).getTime())
      return "Start tidak boleh lebih besar dari End.";
    return "";
  };

  const submit = async () => {
    const msg = validate();
    if (msg) return alert(msg);
    if (authLoading) return;

    if (!allowed) return alert("Unauthorized");
    if (!tenantId) return alert("Tenant tidak ditemukan.");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return alert("Session habis. Silakan login ulang.");

    const period_start_at = jktLocalToISO(startLocal);
    const period_end_at = jktLocalToISO(endLocal);

    await guard.run(async () => {
      try {
        const ins = await supabase
          .from("export_runs")
          .insert({
            tenant_id: tenantId,
            kind,
            status: "queued",
            requested_by: user.id,
            period_start_at,
            period_end_at,
            selected_columns: colsForKind(kind),
            filters: {},
          })
          .select("id")
          .single();

        if (ins.error) throw new Error(ins.error.message);

        onClose();
        onCreated();
      } catch (e: any) {
        alert(e?.message || "Gagal membuat export request.");
      }
    });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
      onMouseDown={(e) => {
        if (guard.submitting) return;
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="w-full max-w-2xl rounded border bg-white shadow"
      >
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold">Run Export</div>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={onClose}
            disabled={guard.submitting}
          >
            Close
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <div className="text-sm text-gray-700">Menu</div>
              <select
                className="w-full rounded border px-3 py-2"
                value={kind}
                onChange={(e) => setKind(e.target.value as ExportKind)}
              >
                <option value="deposits">Deposits</option>
                <option value="withdrawals">Withdrawals</option>
                <option value="interbank_transfers">Interbank Transfer</option>
                <option value="bank_adjustments">Bank Adjustment</option>
                <option value="bank_expenses">Expenses</option>
                <option value="credit_adjustments">Credit Adjustment</option>
              </select>
            </label>

            {/* hardcoded info box untuk semua tipe export */}
            <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              Pilih menu yang ingin di-export dan pastikan Periode yang diminta sudah benar.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <div className="text-sm text-gray-700">Start (JKT)</div>
              <input
                type="datetime-local"
                className="w-full rounded border px-3 py-2"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
              />
            </label>

            <label className="space-y-1">
              <div className="text-sm text-gray-700">End (JKT)</div>
              <input
                type="datetime-local"
                className="w-full rounded border px-3 py-2"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
              />
            </label>
          </div>

          {!allowed && !authLoading && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Role kamu tidak punya akses untuk Run Export.
            </div>
          )}
        </div>

        <div className="p-4 border-t flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded border px-4 py-2 hover:bg-gray-50 disabled:opacity-50"
            onClick={onClose}
            disabled={guard.submitting}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="rounded px-4 py-2 bg-blue-600 text-white disabled:opacity-50"
            disabled={guard.submitting || authLoading || !allowed}
          >
            {guard.submitting ? "Running..." : "Run Export"}
          </button>
        </div>
      </form>
    </div>
  );
}
