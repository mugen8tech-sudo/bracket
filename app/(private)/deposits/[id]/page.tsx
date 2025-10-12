export const dynamic = "force-dynamic";
export const revalidate = 0;

import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { formatAmount } from "@/lib/format";

function fmtJakarta(x?: string | null) {
  if (!x) return "-";
  return new Date(x).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

export default async function DepositDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createServerComponentClient({ cookies });
  const id = Number(params.id);

  // --- ambil deposit + relasi bank/tenant/lead ---
  const { data: dep, error } = await supabase
    .from("deposits")
    .select(
      `
      id, tenant_id, bank_id, lead_id,
      username,
      amount_gross, fee_amount, amount_net,
      credit_basis,
      opened_at, txn_at, performed_at,
      description, status, posted_at, reversed_at,
      created_by,

      bank:banks ( bank_code, account_name, account_no ),
      tenant:tenants ( name ),
      lead:leads ( name )
    `
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !dep) {
    return (
      <div className="rounded border bg-white p-4">Deposit not found.</div>
    );
  }

  // --- nama user pembuat (profiles.full_name) ---
  let createdByName: string | null = dep.created_by;
  if (dep.created_by) {
    const { data: p } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", dep.created_by)
      .maybeSingle();
    createdByName = p?.full_name ?? dep.created_by;
  }

  // --- ambil ledger utama untuk DEPOSIT (before/after) ---
  const { data: bankMut } = await supabase
    .from("bank_mutations")
    .select("amount, balance_before, balance_after, txn_at, performed_at")
    .eq("deposit_id", id)
    .eq("kind", "DEPOSIT")
    .maybeSingle();

  const { data: creditMut } = await supabase
    .from("credit_mutations")
    .select("amount, credit_before, credit_after, txn_at, performed_at")
    .eq("deposit_id", id)
    .eq("kind", "DEPOSIT")
    .maybeSingle();

  // --- jika sudah di-reverse, ambil info reversal (opsional ditampilkan) ---
  const reversed = dep.status === "reversed";
  const { data: bankRev } = reversed
    ? await supabase
        .from("bank_mutations")
        .select("amount, balance_before, balance_after, txn_at, performed_at, description")
        .eq("deposit_id", id)
        .eq("kind", "REVERSAL_DEPOSIT")
        .order("created_at", { ascending: false })
        .maybeSingle()
    : { data: null as any };

  const { data: creditRev } = reversed
    ? await supabase
        .from("credit_mutations")
        .select("amount, credit_before, credit_after, txn_at, performed_at, description")
        .eq("deposit_id", id)
        .eq("kind", "REVERSAL_DEPOSIT")
        .order("created_at", { ascending: false })
        .maybeSingle()
    : { data: null as any };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Deposit Information</h1>

      {/* ----- Ringkasan utama ----- */}
      <div className="rounded border bg-white">
        <table className="table-grid w-full">
          <tbody>
            <tr>
              <td className="w-56">Lead</td>
              <td>{dep.lead?.name ?? "-"}</td>
            </tr>
            <tr>
              <td>Player</td>
              <td>{dep.username}</td>
            </tr>
            <tr>
              <td>Receiver Bank</td>
              <td>
                [{dep.bank?.bank_code}] {dep.bank?.account_name} -{" "}
                {dep.bank?.account_no}
              </td>
            </tr>
            <tr>
              <td>Amount (Gross)</td>
              <td>{formatAmount(dep.amount_gross)}</td>
            </tr>
            <tr>
              <td>Direct Fee</td>
              <td>{formatAmount(dep.fee_amount)}</td>
            </tr>
            <tr>
              <td>Net</td>
              <td>{formatAmount(dep.amount_net)}</td>
            </tr>
            <tr>
              <td>Credit Hit Basis</td>
              <td>
                <b>{dep.credit_basis}</b>{" "}
                <span className="text-xs text-gray-500">
                  (NET → kurangi credit sebesar net; GROSS → sebesar gross)
                </span>
              </td>
            </tr>
            <tr>
              <td>Transaction Time (Selected)</td>
              <td>{fmtJakarta(dep.txn_at)}</td>
            </tr>
            <tr>
              <td>Transaction Time (Real)</td>
              <td>{fmtJakarta(dep.performed_at)}</td>
            </tr>
            <tr>
              <td>Opened At</td>
              <td>{fmtJakarta(dep.opened_at)}</td>
            </tr>
            <tr>
              <td>Website</td>
              <td>{dep.tenant?.name ?? "-"}</td>
            </tr>
            <tr>
              <td>By</td>
              <td>{createdByName ?? "-"}</td>
            </tr>
            <tr>
              <td>Status</td>
              <td className={reversed ? "text-red-600" : "text-green-700"}>
                {reversed ? "REVERSED" : "POSTED"}
              </td>
            </tr>
            {reversed && (
              <tr>
                <td>Reversed At</td>
                <td>{fmtJakarta(dep.reversed_at)}</td>
              </tr>
            )}
            <tr>
              <td>Description</td>
              <td>{dep.description ?? "-"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ----- Ledger: Bank Mutation (DEPOSIT) ----- */}
      <div className="rounded border bg-white">
        <div className="p-3 border-b font-semibold">Bank Mutation (DEPOSIT)</div>
        <table className="table-grid w-full">
          <tbody>
            <tr>
              <td className="w-56">Delta</td>
              <td>{formatAmount(bankMut?.amount ?? dep.amount_net)}</td>
            </tr>
            <tr>
              <td>Balance Before</td>
              <td>{formatAmount(bankMut?.balance_before ?? 0)}</td>
            </tr>
            <tr>
              <td>Balance After</td>
              <td>{formatAmount(bankMut?.balance_after ?? 0)}</td>
            </tr>
            <tr>
              <td>Txn (Selected)</td>
              <td>{fmtJakarta(bankMut?.txn_at ?? dep.txn_at)}</td>
            </tr>
            <tr>
              <td>Performed (Real)</td>
              <td>{fmtJakarta(bankMut?.performed_at ?? dep.performed_at)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ----- Ledger: Credit Mutation (DEPOSIT) ----- */}
      <div className="rounded border bg-white">
        <div className="p-3 border-b font-semibold">Credit Mutation (DEPOSIT)</div>
        <table className="table-grid w-full">
          <tbody>
            <tr>
              <td className="w-56">Delta</td>
              <td>{formatAmount(creditMut?.amount ?? 0)}</td>
            </tr>
            <tr>
              <td>Credit Before</td>
              <td>{formatAmount(creditMut?.credit_before ?? 0)}</td>
            </tr>
            <tr>
              <td>Credit After</td>
              <td>{formatAmount(creditMut?.credit_after ?? 0)}</td>
            </tr>
            <tr>
              <td>Txn (Selected)</td>
              <td>{fmtJakarta(creditMut?.txn_at ?? dep.txn_at)}</td>
            </tr>
            <tr>
              <td>Performed (Real)</td>
              <td>{fmtJakarta(creditMut?.performed_at ?? dep.performed_at)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ----- Jika ada REVERSAL, tampilkan ringkasan ----- */}
      {reversed && (
        <div className="rounded border bg-white">
          <div className="p-3 border-b font-semibold">Reversal</div>
          <table className="table-grid w-full">
            <tbody>
              <tr>
                <td className="w-56">Bank Δ</td>
                <td>{formatAmount(bankRev?.amount ?? 0)}</td>
              </tr>
              <tr>
                <td>Bank Balance Before</td>
                <td>{formatAmount(bankRev?.balance_before ?? 0)}</td>
              </tr>
              <tr>
                <td>Bank Balance After</td>
                <td>{formatAmount(bankRev?.balance_after ?? 0)}</td>
              </tr>
              <tr>
                <td>Credit Δ</td>
                <td>{formatAmount(creditRev?.amount ?? 0)}</td>
              </tr>
              <tr>
                <td>Credit Before</td>
                <td>{formatAmount(creditRev?.credit_before ?? 0)}</td>
              </tr>
              <tr>
                <td>Credit After</td>
                <td>{formatAmount(creditRev?.credit_after ?? 0)}</td>
              </tr>
              <tr>
                <td>Reversal Txn (Selected)</td>
                <td>{fmtJakarta(bankRev?.txn_at ?? creditRev?.txn_at ?? dep.reversed_at)}</td>
              </tr>
              <tr>
                <td>Reversal Performed (Real)</td>
                <td>{fmtJakarta(bankRev?.performed_at ?? creditRev?.performed_at ?? dep.reversed_at)}</td>
              </tr>
              {(bankRev?.description || creditRev?.description) && (
                <tr>
                  <td>Reversal Note</td>
                  <td>{bankRev?.description ?? creditRev?.description}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
