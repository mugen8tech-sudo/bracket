export const dynamic = "force-dynamic";
export const revalidate = 0;

import LeadsTable from "@/components/leads-table";

export default function LeadsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Leads</h1>
      <LeadsTable />
    </div>
  );
}
