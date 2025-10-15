"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type BankLite = { id: number; bank_code: string; account_name: string; account_no: string; };
type ProfileLite = { user_id: string; full_name: string | null };

type AdjRow = {
  id: number;
  bank_id: number;
  amount_delta: number;
  description: string | null;
  txn_at_final: string;
  submitted_at: string;
  created_by: string;
};

function fmtIdDateTime(d: string) {
  const dt = new Date(d);
  const date = dt.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" });
  const time = dt.toLocaleTimeString("id-ID", { hour12: false, timeZone: "Asia/Jakarta" }).replace(/:/g, ".");
  return `${date}, ${time}`;
}

export default function BankAdjustmentDetailPage() {
  const supabase = supabaseBrowser();
  const { id } = useParams<{ id: string }>();

  const [row, setRow] = useState<AdjRow | null>(null);
  const [bank, setBank] = useState<BankLite | null>(null);
  const [byName, setByName] = useState<string>("");

  useEffect(() => {
    (async () => {
      if (!id) return;
      const { data, error } = await supabase
        .from("bank_adjustments")
        .select("*")
        .eq("id", Number(id))
        .single();
      if (error) { alert(error.message); return; }

      const adj = data as AdjRow;
      setRow(adj);

      const [bRes, pRes] = await Promise.all([
        supabase.from("banks").select("id, bank_code, account_name, account_no").eq("id", adj.bank_id).maybeSingle(),
        supabase.from("profiles").select("user_id, full_name").eq("user_id", adj.created_by).maybeSingle(),
      ]);
      setBank((bRes.data as BankLite | null) ?? null);
      const prof = (pRes.data as ProfileLite | null);
      setByName(prof?.full_name ?? adj.created_by);
    })();
  }, [id, supabase]);

  if (!row) {
    return (
      <div className="space-y-3">
        <div className="rounded border bg-white p-3"><b>Bank Adjustment Information</b></div>
        <div className="rounded border bg-white p-4">Loading…</div>
      </div>
    );
  }

  const bankLabel = bank ? `[${bank.bank_code}] ${bank.account_name} - ${bank.account_no}` : "[]";

  return (
    <div className="space-y-3">
      <div className="rounded border bg-white p-3"><b>Bank Adjustment Information</b></div>

      <div className="rounded border bg-white p-0 overflow-hidden">
        <table className="w-full">
          <tbody>
            <tr>
              <td className="w-72 p-3 border-b bg-gray-50">Bank</td>
              <td className="p-3 border-b">{bankLabel}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Amount</td>
              <td className="p-3 border-b">{formatAmount(row.amount_delta)}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Description</td>
              <td className="p-3 border-b">{row.description ?? ""}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Transaction Time</td>
              <td className="p-3 border-b">{fmtIdDateTime(row.txn_at_final)}</td>
            </tr>
            <tr>
              <td className="p-3 bg-gray-50">Confirmation</td>
              <td className="p-3">Confirmed by {byName} at {fmtIdDateTime(row.submitted_at)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <Link href="/bank_adjustments" className="rounded bg-gray-100 px-4 py-2 inline-block">Back</Link>
    </div>
  );
}
