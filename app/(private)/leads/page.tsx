// Hindari prerender statis agar selalu memeriksa sesi
export const dynamic = "force-dynamic";
export const revalidate = 0;

import LeadsTable from "@/components/leads-table";

export default function LeadsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Leads</h1>
      <LeadsTable />
      <p className="text-xs text-gray-500">
        Catatan: Fitur <b>Tele</b>, <b>Product</b>, <b>Direct Assign Tele</b>, dan <b>Delete</b> sengaja disembunyikan.
      </p>
    </div>
  );
}
