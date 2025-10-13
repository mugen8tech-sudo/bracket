export const dynamic = "force-dynamic";
export const revalidate = 0;

import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { formatAmount } from "@/lib/format";

function fmtJakarta(x?: string | null) {
  if (!x) return "-";
  return new Date(x).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

export default async function WithdrawalDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServerComponentClient({ cookies });
  const id = Number(params.id);

  // --- ambil WD + relasi ---
  const { data: wd, error } = await supabase
    .from("withdrawals")
    .select(`
      id, tenant_id, bank_id, lead_id, username,
      amount_gross, transfer_fee_amount,
      opened_at, txn_at, performed_at,
      description, status, posted_at, reversed_at,
      created_by
    `)
    .eq("id", id)
    .maybeSingle();

  if (error || !wd) return <div className="rounded border bg-white p-4">Withdrawal not found.</div>;

  const [{ data: lead }, { data: bank }, { data: tenant }] = await Promise.all([
    supabase.from("leads").select("name").eq("id", wd.lead_id).maybeSingle(),
    supabase.from("banks").select("bank_code, account_name, account_no").eq("id", wd.bank_id).maybeSingle(),
    supabase.from("tenants").select("name").eq("id", wd.tenant_id).maybeSingle(),
  ]);

  // nama pembuat
  let createdByName: string | null = wd.created_by;
  if (wd.created_by) {
    const { data: p } = await supabase.from("profiles").select("full_name").eq("user_id", wd.created_by).maybeSingle();
    createdByName = p?.full_name ?? wd.created_by;
  }

  // ledger utama
  const { data: bankMut } = await supabase
    .from("bank_mutations")
    .select("amount, balance_before, balance_after, txn_at, performed_at, description")
    .eq("deposit_id", id)
    .eq("kind", "WITHDRAWAL")
    .maybeSingle();

  const { data: creditMut } = await supabase
    .from("credit_mutations")
    .select("amount, credit_before, credit_after, txn_at, performed_at, description")
    .eq("deposit_id", id)
    .eq("kind", "WITHDRAWAL")
    .maybeSingle();

  // fee (kalau ada) → EXPENSE baris terpisah
  const { data: feeMut } = wd.transfer_fee_amount > 0
    ? await supabase
        .from("bank_mutations")
        .select("amount, balance_before, balance_after, txn_at, performed_at, description")
        .eq("deposit_id", id)
        .eq("kind", "EXPENSE")
        .order("created_at", { ascending: true })
        .maybeSingle()
    : { data: null as any };

  // jika reversed → ambil reversal
  const reversed = wd.status === "reversed";
  const { data: bankRev } = reversed
    ? await supabase
        .from("bank_mutations")
        .select("amount, balance_before, balance_after, txn_at, performed_at, description")
        .eq("deposit_id", id)
        .eq("kind", "REVERSAL_WITHDRAWAL")
        .order("created_at", { ascending: false })
        .maybeSingle()
    : { data: null as any };

  const { data: creditRev } = reversed
    ? await supabase
        .from("credit_mutations")
        .select("amount, credit_before, credit_after, txn_at, performed_at, description")
        .eq("deposit_id", id)
        .eq("kind", "REVERSAL_WITHDRAWAL")
        .order("created_at", { ascending: false })
        .maybeSingle()
    : { data: null as any };

  // reversal fee (positif), jika ada
  const { data: feeRev } = reversed
    ? await supabase
        .from("bank_mutations")
        .select("amount, balance_before, balance_after, txn_at, performed_at, description")
        .eq("deposit_id", id)
        .eq("kind", "EXPENSE")
        .order("created_at", { ascending: false })
        .maybeSingle()
    : { data: null as any };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Withdrawal Information</h1>

      <div className="rounded border bg-white">
        <table className="table-grid w-full">
          <tbody>
            <tr><td className="w-56">Lead</td><td>{lead?.name ?? "-"}</td></tr>
            <tr><td>Player</td><td>{wd.username}</td></tr>
            <tr><td>Sender Bank</td><td>{bank ? `[${bank.bank_code}] ${bank.account_name} ${bank.account_no}` : "-"}</td></tr>
            <tr><td>Amount (Gross)</td><td>{formatAmount(wd.amount_gross)}</td></tr>
            <tr><td>Transfer Fee</td><td>{formatAmount(wd.transfer_fee_amount)}</td></tr>
            <tr><td>Transaction Time (Selected)</td><td>{fmtJakarta(wd.txn_at)}</td></tr>
            <tr><td>Transaction Time (Real)</td><td>{fmtJakarta(wd.performed_at)}</td></tr>
            <tr><td>Opened At</td><td>{fmtJakarta(wd.opened_at)}</td></tr>
            <tr><td>Website</td><td>{tenant?.name ?? "-"}</td></tr>
            <tr><td>By</td><td>{createdByName ?? "-"}</td></tr>
            <tr>
              <td>Status</td>
              <td className={reversed ? "text-red-600" : "text-green-700"}>
                {reversed ? "REVERSED" : "POSTED"}
              </td>
            </tr>
            {reversed && (
              <tr><td>Reversed At</td><td>{fmtJakarta(wd.reversed_at)}</td></tr>
            )}
            <tr><td>Description</td><td>{wd.description ?? "-"}</td></tr>
          </tbody>
        </table>
      </div>

      {/* Bank Mutation (WITHDRAWAL) */}
      <div className="rounded border bg-white">
        <div className="p-3 border-b font-semibold">Bank Mutation (WITHDRAWAL)</div>
        <table className="table-grid w-full">
          <tbody>
            <tr><td className="w-56">Delta</td><td>{formatAmount(bankMut?.amount ?? -wd.amount_gross)}</td></tr>
            <tr><td>Balance Before</td><td>{formatAmount(bankMut?.balance_before ?? 0)}</td></tr>
            <tr><td>Balance After</td><td>{formatAmount(bankMut?.balance_after ?? 0)}</td></tr>
            <tr><td>Txn (Selected)</td><td>{fmtJakarta(bankMut?.txn_at ?? wd.txn_at)}</td></tr>
            <tr><td>Performed (Real)</td><td>{fmtJakarta(bankMut?.performed_at ?? wd.performed_at)}</td></tr>
          </tbody>
        </table>
      </div>

      {/* Transfer Fee (Expense) */}
      {wd.transfer_fee_amount > 0 && (
        <div className="rounded border bg-white">
          <div className="p-3 border-b font-semibold">Transfer Fee (EXPENSE)</div>
          <table className="table-grid w-full">
            <tbody>
              <tr><td className="w-56">Delta</td><td>{formatAmount(feeMut?.amount ?? -wd.transfer_fee_amount)}</td></tr>
              <tr><td>Balance Before</td><td>{formatAmount(feeMut?.balance_before ?? 0)}</td></tr>
              <tr><td>Balance After</td><td>{formatAmount(feeMut?.balance_after ?? 0)}</td></tr>
              <tr><td>Txn (Selected)</td><td>{fmtJakarta(feeMut?.txn_at ?? wd.txn_at)}</td></tr>
              <tr><td>Performed (Real)</td><td>{fmtJakarta(feeMut?.performed_at ?? wd.performed_at)}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Credit Mutation (WITHDRAWAL) */}
      <div className="rounded border bg-white">
        <div className="p-3 border-b font-semibold">Credit Mutation (WITHDRAWAL)</div>
        <table className="table-grid w-full">
          <tbody>
            <tr><td className="w-56">Delta</td><td>{formatAmount(creditMut?.amount ?? wd.amount_gross)}</td></tr>
            <tr><td>Credit Before</td><td>{formatAmount(creditMut?.credit_before ?? 0)}</td></tr>
            <tr><td>Credit After</td><td>{formatAmount(creditMut?.credit_after ?? 0)}</td></tr>
            <tr><td>Txn (Selected)</td><td>{fmtJakarta(creditMut?.txn_at ?? wd.txn_at)}</td></tr>
            <tr><td>Performed (Real)</td><td>{fmtJakarta(creditMut?.performed_at ?? wd.performed_at)}</td></tr>
          </tbody>
        </table>
      </div>

      {/* Reversal */}
      {reversed && (
        <div className="rounded border bg-white">
          <div className="p-3 border-b font-semibold">Reversal</div>
          <table className="table-grid w-full">
            <tbody>
              <tr><td className="w-56">Bank Δ</td><td>{formatAmount(bankRev?.amount ?? 0)}</td></tr>
              <tr><td>Bank Balance Before</td><td>{formatAmount(bankRev?.balance_before ?? 0)}</td></tr>
              <tr><td>Bank Balance After</td><td>{formatAmount(bankRev?.balance_after ?? 0)}</td></tr>
              <tr><td>Credit Δ</td><td>{formatAmount(creditRev?.amount ?? 0)}</td></tr>
              <tr><td>Credit Before</td><td>{formatAmount(creditRev?.credit_before ?? 0)}</td></tr>
              <tr><td>Credit After</td><td>{formatAmount(creditRev?.credit_after ?? 0)}</td></tr>
              <tr><td>Reversal Txn (Selected)</td><td>{fmtJakarta(bankRev?.txn_at ?? creditRev?.txn_at ?? wd.reversed_at)}</td></tr>
              <tr><td>Reversal Performed (Real)</td><td>{fmtJakarta(bankRev?.performed_at ?? creditRev?.performed_at ?? wd.reversed_at)}</td></tr>
              {wd.transfer_fee_amount > 0 && feeRev && (
                <tr><td>Reversal Fee</td><td>{formatAmount(feeRev.amount)}</td></tr>
              )}
              {(bankRev?.description || creditRev?.description) && (
                <tr><td>Reversal Note</td><td>{bankRev?.description ?? creditRev?.description}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
