"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type BankLite = { id: number; bank_code: string; account_name: string; account_no: string; };
type ProfileLite = { user_id: string; full_name: string | null };

type IBTRow = {
  id: number;
  bank_from_id: number;
  bank_to_id: number;
  amount_gross: number;
  transfer_fee_amount: number | null;
  from_txn_at: string;
  to_txn_at: string;
  submitted_at: string;
  description: string | null;
  created_by: string;
};

function fmtIdDateTime(d: string) {
  const dt = new Date(d);
  const date = dt.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" });
  const time = dt.toLocaleTimeString("id-ID", { hour12: false, timeZone: "Asia/Jakarta" }).replace(/:/g, ".");
  return `${date}, ${time}`;
}

export default function InterbankTransferDetailPage() {
  const supabase = supabaseBrowser();
  const { id } = useParams<{ id: string }>();

  const [row, setRow] = useState<IBTRow | null>(null);
  const [banks, setBanks] = useState<Record<number, BankLite>>({});
  const [byName, setByName] = useState<string>("");

  useEffect(() => {
    (async () => {
      if (!id) return;

      const { data, error } = await supabase
        .from("interbank_transfers")
        .select("*")
        .eq("id", Number(id))
        .single();
      if (error) { alert(error.message); return; }
      const r = data as IBTRow;
      setRow(r);

      // lookups
      const [bankRes, profRes] = await Promise.all([
        supabase.from("banks")
          .select("id, bank_code, account_name, account_no")
          .in("id", [r.bank_from_id, r.bank_to_id]),
        supabase.from("profiles")
          .select("user_id, full_name")
          .eq("user_id", r.created_by)
          .maybeSingle(),
      ]);

      const bList = (bankRes.data as BankLite[]) ?? [];
      setBanks(Object.fromEntries(bList.map(b => [b.id, b])));
      const prof = (profRes.data as ProfileLite | null);
      setByName(prof?.full_name ?? r.created_by);
    })();
  }, [id, supabase]);

  const bankLabel = (id: number) => {
    const b = banks[id];
    return b ? `[${b.bank_code}] ${b.account_name} - ${b.account_no}` : "[]";
  };

  if (!row) {
    return (
      <div className="space-y-3">
        <div className="rounded border bg-white p-3"><b>Interbank Transfer Information</b></div>
        <div className="rounded border bg-white p-4">Loading…</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded border bg-white p-3"><b>Interbank Transfer Information</b></div>

      <div className="rounded border bg-white p-0 overflow-hidden">
        <table className="w-full">
          <tbody>
            <tr>
              <td className="w-72 p-3 border-b bg-gray-50">Bank Asal</td>
              <td className="p-3 border-b">{bankLabel(row.bank_from_id)}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Bank Asal Transaction Time</td>
              <td className="p-3 border-b">{fmtIdDateTime(row.from_txn_at)}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Amount</td>
              <td className="p-3 border-b">{formatAmount(row.amount_gross)}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Biaya Transfer</td>
              <td className="p-3 border-b">{formatAmount(row.transfer_fee_amount ?? 0)}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Description</td>
              <td className="p-3 border-b">{row.description ?? ""}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Bank Tujuan</td>
              <td className="p-3 border-b">{bankLabel(row.bank_to_id)}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Bank Tujuan Transaction Time</td>
              <td className="p-3 border-b">{fmtIdDateTime(row.to_txn_at)}</td>
            </tr>
            <tr>
              <td className="p-3 bg-gray-50">Confirmation</td>
              <td className="p-3">
                Confirmed by {byName} at {fmtIdDateTime(row.submitted_at)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <Link href="/interbank-transfer" className="rounded bg-gray-100 px-4 py-2 inline-block">Back</Link>
    </div>
  );
}
