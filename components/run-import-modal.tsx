"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type ImportMode = "deposits" | "withdrawals" | "both";
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
  // "YYYY-MM-DD HH:mm:ss" (sv-SE) -> "YYYY-MM-DDTHH:mm:ss"
  return new Date()
    .toLocaleString("sv-SE", { timeZone: "Asia/Jakarta", hour12: false })
    .replace(" ", "T");
}

function jktLocalToISO(v: string) {
  // treat input as Asia/Jakarta (UTC+7), convert to UTC ISO
  if (!v) return "";
  let x = v;
  if (x.length === 16) x += ":00"; // YYYY-MM-DDTHH:mm -> add seconds
  return new Date(x + "+07:00").toISOString();
}

function uid() {
  // browser-safe unique token
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = typeof crypto !== "undefined" ? crypto : null;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

export default function RunImportModal({
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

  const [mode, setMode] = useState<ImportMode>("deposits");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [fileDep, setFileDep] = useState<File | null>(null);
  const [fileWd, setFileWd] = useState<File | null>(null);

  const [tenantId, setTenantId] = useState<string>("");
  const [role, setRole] = useState<AnyRole>("other");
  const [authLoading, setAuthLoading] = useState(true);

  const allowed = useMemo(() => {
    return new Set<AnyRole>(["admin", "operator", "cs", "cs_dp", "cs_wd"]).has(role);
  }, [role]);

  // init defaults when open
  useEffect(() => {
    if (!open) return;
    const d = todayJakartaDateStr();
    setStartLocal(`${d}T00:00:00`);
    setEndLocal(nowJakartaDatetimeLocalValue());
    setFileDep(null);
    setFileWd(null);
    setMode("deposits");
  }, [open]);

  // load tenant + role
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

  // ESC close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const needDep = mode === "deposits" || mode === "both";
  const needWd = mode === "withdrawals" || mode === "both";

  const validate = () => {
    if (!startLocal || !endLocal) return "Start/End wajib diisi.";
    const sISO = jktLocalToISO(startLocal);
    const eISO = jktLocalToISO(endLocal);
    if (!sISO || !eISO) return "Start/End tidak valid.";
    if (new Date(sISO).getTime() > new Date(eISO).getTime())
      return "Start tidak boleh lebih besar dari End.";

    if (needDep && !fileDep) return "File deposit wajib diupload.";
    if (needWd && !fileWd) return "File withdrawal wajib diupload.";

    return "";
  };

  const submit = async () => {
    const msg = validate();
    if (msg) {
      alert(msg);
      return;
    }
    if (authLoading) return;

    if (!allowed) {
      alert("Unauthorized");
      return;
    }
    if (!tenantId) {
      alert("Tenant tidak ditemukan.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      alert("Session habis. Silakan login ulang.");
      return;
    }

    const period_start_at = jktLocalToISO(startLocal);
    const period_end_at = jktLocalToISO(endLocal);

    // helper create 1 run (upload -> insert)
    const createOne = async (kind: "deposits" | "withdrawals", file: File) => {
      const token = uid();
      const storage_path = `${tenantId}/import_runs/${token}/${kind}.xlsx`;

      // 1) upload file dulu (biar kalau insert sukses, file pasti ada)
      const up = await supabase.storage
        .from("import_exports")
        .upload(storage_path, file, {
          upsert: true,
          contentType:
            file.type ||
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });

      if (up.error) throw new Error(up.error.message);

      // 2) insert run (status queued)
      const ins = await supabase
        .from("import_runs")
        .insert({
          tenant_id: tenantId,
          kind,
          status: "queued",
          requested_by: user.id,
          period_start_at,
          period_end_at,
          file_name: file.name,
          panel_file_name: file.name,
          storage_path,
          // storage_bucket pakai default 'import_exports'
        })
        .select("id")
        .single();

      if (ins.error) throw new Error(ins.error.message);

      return ins.data?.id;
    };

    await guard.run(async () => {
      try {
        if (needDep && fileDep) {
          await createOne("deposits", fileDep);
        }
        if (needWd && fileWd) {
          await createOne("withdrawals", fileWd);
        }

        // close & refresh history, no auto-open detail
        onClose();
        onCreated();
      } catch (e: any) {
        alert(e?.message || "Gagal membuat import request.");
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
        onKeyDown={(e) => {
          if (guard.submitting && e.key === "Enter") e.preventDefault();
        }}
        className="w-full max-w-2xl rounded border bg-white shadow"
      >
        {/* header (samain dengan Run Export) */}
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold">Run Import</div>
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
          {/* row 1: menu + info box */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <div className="text-sm text-gray-700">Menu</div>
              <select
                className="w-full rounded border px-3 py-2"
                value={mode}
                onChange={(e) => setMode(e.target.value as ImportMode)}
              >
                <option value="deposits">Deposits</option>
                <option value="withdrawals">Withdrawals</option>
                <option value="both">Deposits + Withdrawals</option>
              </select>
            </label>

            <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              Pilih menu yang ingin di-import, pastikan File yang di-upload dan Periode yang diminta
              sudah benar.
            </div>
          </div>

          {/* row 2: periode */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <div className="text-sm text-gray-700">Start (JKT)</div>
              <input
                type="datetime-local"
                step="1"
                className="w-full rounded border px-3 py-2"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                required
              />
            </label>

            <label className="space-y-1">
              <div className="text-sm text-gray-700">End (JKT)</div>
              <input
                type="datetime-local"
                step="1"
                className="w-full rounded border px-3 py-2"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
                required
              />
            </label>
          </div>

          {/* uploads */}
          {needDep && (
            <div className="space-y-1">
              <div className="text-sm text-gray-700">Upload Export Deposits (.xlsx)</div>
              <input
                type="file"
                className="w-full text-sm"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFileDep(e.target.files?.[0] || null)}
              />
              {fileDep && (
                <div className="text-xs text-gray-600">
                  Selected: <b>{fileDep.name}</b>
                </div>
              )}
            </div>
          )}

          {needWd && (
            <div className="space-y-1">
              <div className="text-sm text-gray-700">Upload Export Withdrawals (.xlsx)</div>
              <input
                type="file"
                className="w-full text-sm"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFileWd(e.target.files?.[0] || null)}
              />
              {fileWd && (
                <div className="text-xs text-gray-600">
                  Selected: <b>{fileWd.name}</b>
                </div>
              )}
            </div>
          )}

          {!allowed && !authLoading && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Role kamu tidak punya akses untuk Run Import.
            </div>
          )}
        </div>

        {/* footer (samain dengan Run Export) */}
        <div className="p-4 border-t flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded border px-4 py-2 hover:bg-gray-50 disabled:opacity-50"
            onClick={onClose}
            disabled={guard.submitting}
            aria-disabled={guard.submitting}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="rounded px-4 py-2 bg-blue-600 text-white disabled:opacity-50"
            disabled={guard.submitting || authLoading}
            aria-disabled={guard.submitting || authLoading}
          >
            {guard.submitting ? "Submitting..." : "Run Import"}
          </button>
        </div>
      </form>
    </div>
  );
}
