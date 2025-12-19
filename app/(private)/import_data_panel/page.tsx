export const dynamic = "force-dynamic";
export const revalidate = 0;

import ImportDataPanel from "@/components/import-data-panel";

export default function ImportDataPanelPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Import Data Panel</h1>
      <ImportDataPanel />
    </div>
  );
}
