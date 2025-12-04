"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type AdjRow = {
  id: number;
  tenant_id: string;
  bank_id: number;
  amount_delta: number;
  opened_at: string | null;
  txn_at_final: string;
  submitted_at: string;
  description: string | null;
  created_by: string;
  mutation_id: number;
};

type BankLite = { id: number; bank_code: string; account_name: string; account_no: string };
type ProfileLite = { user_id: string; full_name: string | null };

const PAGE_SIZE = 25;

// ===== Role helpers (samakan dengan Banks & UserManagement) =====
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

function startOfDayJakartaISO(d: string) {
  return new Date(`${d}T00:00:00+07:00`).toISOString();
}
function endOfDayJakartaISO(d: string) {
  return new Date(`${d}T23:59:59.999+07:00`).toISOString();
}
function todayJakartaYMD() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
function fmtIdDateTime(d: string) {
  const dt = new Date(d);
  const date = dt.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" });
  const time = dt
    .toLocaleTimeString("id-ID", { hour12: false, timeZone: "Asia/Jakarta" })
    .replace(/:/g, ".");
  return `${date}, ${time}`;
}

export default function BankAdjustmentsTable() {
  const supabase = supabaseBrowser();

  // ===== Guard: hanya Admin & Operator =====
  const [authorized, setAuthorized] = useState<"loading" | "ok" | "no">("loading");
  const [myRole, setMyRole] = useState<AnyRole>("other");

  const [rows, setRows] = useState<AdjRow[]>([]);
  const [banks, setBanks] = useState<Record<number, BankLite>>({});
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const [fStart, setFStart] = useState(todayJakartaYMD());
  const [fFinish, setFFinish] = useState(todayJakartaYMD());

  // Bootstrap role
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
        console.error("profiles role error:", error);
        setAuthorized("no");
        return;
      }

      const role = normalizeRole((prof as any)?.role);
      setMyRole(role);

      // Bank Adjustment (Adj) page: hanya admin & operator
      if (role === "admin" || role === "operator") {
        setAuthorized("ok");
      } else {
        setAuthorized("no");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async (pageToLoad = page) => {
    setLoading(true);

    let q = supabase
      .from("bank_adjustments")
      .select("*", { count: "exact" })
      .order("submitted_at", { ascending: false })
      .order("id", { ascending: false });

    if (fStart) q = q.gte("submitted_at", startOfDayJakartaISO(fStart));
    if (fFinish) q = q.lte("submitted_at", endOfDayJakartaISO(fFinish));

    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error, count } = await q.range(from, to);
    if (error) {
      setLoading(false);
      alert(error.message);
      return;
    }

    const list = (data as AdjRow[]) ?? [];

    // lookups
    const bankIds = Array.from(new Set(list.map((r) => r.bank_id)));
    const userIds = Array.from(new Set(list.map((r) => r.created_by)));

    const [bankRes, profRes] = await Promise.all([
      bankIds.length
        ? supabase
            .from("banks")
            .select("id, bank_code, account_name, account_no")
            .in("id", bankIds)
        : Promise.resolve({ data: [] as any[] }),
      userIds.length
        ? supabase
            .from("profiles")
            .select("user_id, full_name")
            .in("user_id", userIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    setBanks(
      Object.fromEntries(
        ((bankRes.data as BankLite[]) ?? []).map((b) => [b.id, b]),
      ),
    );
    setProfiles(
      Object.fromEntries(
        ((profRes.data as ProfileLite[]) ?? []).map((p) => [
          p.user_id,
          p.full_name ?? p.user_id,
        ]),
      ),
    );

    setRows(list);
    setTotal(count ?? list.length);
    setPage(pageToLoad);
    setLoading(false);
  };

  // Load data hanya setelah authorized
  useEffect(() => {
    if (authorized === "ok") {
      load(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized]);

  const bankLabel = (id: number) => {
    const b = banks[id];
    return b ? `[${b.bank_code}] ${b.account_name} - ${b.account_no}` : "[]";
  };

  // ===== Guard render =====
  if (authorized === "loading") {
    return <div className="p-6">Loading…</div>;
  }

  if (authorized === "no") {
    return (
      <div className="p-6">
        <div className="text-red-600 font-semibold mb-2">Unauthorized</div>
      </div>
    );
  }

  // ===== Normal render (authorized) =====
  return (
    <div className="space-y-3">
      <div className="rounded border bg-white p-3">
        <b>Bank Adjustments</b>
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table
          className="table-grid min-w-[1000px]"
          style={{ borderCollapse: "collapse" }}
        >
          <thead>
            {/* Baris filter HARUS sejajar jumlah kolom */}
            <tr className="filters">
              {/* ID */} <th className="w-16" />
              {/* Bank */} <th className="w-[320px]" />
              {/* Amount */} <th className="w-40" />
              {/* Description */} <th className="w-64" />
              {/* Tgl (2 input) */}
              <th className="w-56">
                <div className="flex flex-col gap-1">
                  <input
                    type="date"
                    value={fStart}
                    onChange={(e) => setFStart(e.target.value)}
                    className="border rounded px-2 py-1 w-full"
                    placeholder=", dd --- yyyy"
                  />
                  <input
                    type="date"
                    value={fFinish}
                    onChange={(e) => setFFinish(e.target.value)}
                    className="border rounded px-2 py-1 w-full"
                    placeholder=", dd --- yyyy"
                  />
                </div>
              </th>
              {/* By */} <th className="w-40" />
              {/* Action (Submit) */}
              <th className="w-24">
                <button
                  onClick={() => load(1)}
                  className="rounded bg-blue-600 text-white px-3 py-1 w-full"
                >
                  Submit
                </button>
              </th>
            </tr>

            <tr>
              <th className="text-left w-16">ID</th>
              <th className="text-left w-[320px]">Bank</th>
              <th className="text-right w-40">Amount</th>
              <th className="text-left w-64">Description</th>
              <th className="text-left w-56">Tgl</th>
              <th className="text-left w-40">By</th>
              <th className="text-left w-24">Action</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7}>Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7}>No data</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td>{r.id}</td>
                  <td>{bankLabel(r.bank_id)}</td>
                  <td className="text-right">{formatAmount(r.amount_delta)}</td>
                  <td className="whitespace-normal break-words">
                    {r.description || "-"}
                  </td>
                  <td>{fmtIdDateTime(r.submitted_at)}</td>
                  <td>{profiles[r.created_by] ?? r.created_by}</td>
                  <td>
                    <Link
                      href={`/bank_adjustments/${r.id}`}
                      className="rounded bg-gray-100 px-3 py-1 inline-block"
                    >
                      Detail
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button
            onClick={() => page > 1 && load(1)}
            disabled={page <= 1}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            First
          </button>
          <button
            onClick={() => page > 1 && load(page - 1)}
            disabled={page <= 1}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 rounded border bg-white">
            Page {page} / {Math.max(1, Math.ceil(total / 50))}
          </span>
          <button
            onClick={() => page < totalPages && load(page + 1)}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={() => page < totalPages && load(totalPages)}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Last
          </button>
        </nav>
      </div>
    </div>
  );
}
