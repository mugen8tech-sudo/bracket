export const dynamic = "force-dynamic";
export const revalidate = 0;

import BanksTable from "@/components/banks-table";

export default function BanksPage() {
  return (
    <div className="space-y-4">
      <BanksTable />
    </div>
  );
}
