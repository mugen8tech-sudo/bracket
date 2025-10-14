export const dynamic = "force-dynamic";
export const revalidate = 0;

import PendingDepositsTable from "@/components/pending-deposits-table";

export default function PendingDepositsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Pending Deposits</h1>
      <PendingDepositsTable />
    </div>
  );
}
