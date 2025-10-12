export const dynamic = "force-dynamic";
export const revalidate = 0;

import DepositsTable from "@/components/deposits-table";

export default function DepositsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Deposits</h1>
      <DepositsTable />
    </div>
  );
}
