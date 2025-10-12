export const dynamic = "force-dynamic";
export const revalidate = 0;

import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { formatAmount } from "@/lib/format";

export default async function DepositDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServerComponentClient({ cookies });
  const id = Number(params.id);

  // ambil deposit
  const { data: dep, error } = await supabase
    .from("deposits")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !dep) {
    return <div className="rounded border bg-white p-4">Deposit not found.</div>;
  }

  // bank penerima
  const { data: bank } = await supabase
    .from("banks")
    .select("bank_code, account_name, account_no")
    .eq("id", dep.bank_id)
    .single();

  // nama tenant (website)
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", dep.tenant_id)
    .single();

  // nama user pembuat (profiles.full_name)
  let createdByName: string | null = dep.created_by;
  if (dep.created_by) {
    const { data: p } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", dep.created_by)
      .single();
    createdByName = p?.full_name ?? dep.created_by;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Deposit Information</h1>
      <div className="rounded border bg-white">
        <table className="table-grid w-full">
          <tbody>
            <tr><td className="w-48">Lead</td><td>{dep.lead_name_snapshot ?? "-"}</td></tr>
            <tr>
              <td>Receiver Bank</td>
              <td>[{bank?.bank_code}] {bank?.account_name} - {bank?.account_no}</td>
            </tr>
            <tr><td>Amount (Gross)</td><td>{formatAmount(dep.amount_gross)}</td></tr>
            <tr><td>Direct Fee</td><td>{formatAmount(dep.fee_direct_amount)}</td></tr>
            <tr><td>Net</td><td>{formatAmount(dep.amount_net)}</td></tr>
            <tr><td>Transaction Time</td><td>{new Date(dep.txn_at_opened).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td></tr>
            <tr><td>Transaction Time (Selected)</td><td>{new Date(dep.txn_at_final).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td></tr>
            <tr><td>Player</td><td>{dep.username_snapshot}</td></tr>
            <tr><td>Website</td><td>{tenant?.name ?? "-"}</td></tr>
            <tr><td>By</td><td>{createdByName ?? "-"}</td></tr>
            <tr><td>Deleted?</td><td>{dep.is_deleted ? "YES" : "NO"}</td></tr>
            {dep.is_deleted && (
              <>
                <tr><td>Deleted At</td><td>{new Date(dep.deleted_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td></tr>
                <tr><td>Delete Note</td><td>{dep.delete_note}</td></tr>
              </>
            )}
            <tr><td>Description</td><td>{dep.description ?? "-"}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
