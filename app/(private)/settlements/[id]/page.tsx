"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type BankLite = { id: number; bank_code: string; account_name: string; account_no: string };
type ProfileLite = { user_id: string; full_name: string | null };

type Settlement = {
  id: number;
  bank_id: number;
  entry: "IN" | "OUT";
  amount: number;
  fee: number;
  description: string | null;
  target_bank_provider: string;
  target_account_name: string | null;
  target_account_number: string | null;
  start_at: string | null;
  end_at: string | null;
  txn_at: string;
  performed_at: string;
  created_by: string;
};

function fmtIdDateTime(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  const date = dt.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" });
  const time = dt
    .toLocaleTimeString("id-ID", { hour12: false, timeZone: "Asia/Jakarta" })
    .replace(/:/g, ".");
  return `${date}, ${time}`;
}

export default function SettlementDetailPage() {
  const supabase = supabaseBrowser();
  const { id } = useParams<{ id: string }>();

  const [row, setRow] = useState<Settlement | null>(null);
  const [bank, setBank] = useState<BankLite | null>(null);
  const [byName, setByName] = useState<string>("");

  useEffect(() => {
    (async () => {
      if (!id) return;

      const { data, error } = await supabase
        .from("settlements")
        .select(
          "id, bank_id, entry, amount, fee, description, target_bank_provider, target_account_name, target_account_number, start_at, end_at, txn_at, performed_at, created_by"
        )
        .eq("id", Number(id))
        .single();
      if (error) {
        alert(error.message);
        return;
      }
      const r = data as Settlement;
      setRow(r);

      const [bankRes, profRes] = await Promise.all([
        supabase
          .from("banks")
          .select("id, bank_code, account_name, account_no")
          .eq("id", r.bank_id)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("user_id, full_name")
          .eq("user_id", r.created_by)
          .maybeSingle(),
      ]);

      setBank(bankRes.data as BankLite | null);
      const prof = profRes.data as ProfileLite | null;
      setByName(prof?.full_name ?? r.created_by);
    })();
  }, [id, supabase]);

  const bankLabel = (b: BankLite | null) =>
    b ? `[${b.bank_code}] ${b.account_name} - ${b.account_no}` : "—";

  if (!row) {
    return (
      <div className="space-y-3">
        <div className="rounded border bg-white p-3">
          <b>Settlement Information</b>
        </div>
        <div className="rounded border bg-white p-4">Loading…</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded border bg-white p-3">
        <b>Settlement Information</b>
      </div>

      <div className="rounded border bg-white p-0 overflow-hidden">
        <table className="w-full">
          <tbody>
            <tr>
              <td className="w-72 p-3 border-b bg-gray-50">Bank</td>
              <td className="p-3 border-b">{bankLabel(bank)}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Entry</td>
              <td className="p-3 border-b">
                {row.entry === "IN" ? "Uang Masuk" : "Uang Keluar"}
              </td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Amount</td>
              <td className="p-3 border-b">{formatAmount(row.amount)}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Biaya Transfer</td>
              <td className="p-3 border-b">{formatAmount(row.fee ?? 0)}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Description</td>
              <td className="p-3 border-b">{row.description ?? ""}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Target</td>
              <td className="p-3 border-b">
                {row.target_bank_provider}
                {row.target_account_name ? ` - ${row.target_account_name}` : ""}
                {row.target_account_number ? ` - ${row.target_account_number}` : ""}
              </td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Mulai Akuran</td>
              <td className="p-3 border-b">{fmtIdDateTime(row.start_at)}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Akhir Akuran</td>
              <td className="p-3 border-b">{fmtIdDateTime(row.end_at)}</td>
            </tr>
            <tr>
              <td className="p-3 border-b bg-gray-50">Transaction Time</td>
              <td className="p-3 border-b">{fmtIdDateTime(row.txn_at)}</td>
            </tr>
            <tr>
              <td className="p-3 bg-gray-50">Confirmation</td>
              <td className="p-3">
                Confirmed by {byName} at {fmtIdDateTime(row.performed_at)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <Link
        href="/settlements"
        className="rounded bg-gray-100 px-4 py-2 inline-block"
      >
        Back
      </Link>
    </div>
  );
}
