"use client";

import { useState } from "react";
import ImportRunsHistory from "@/components/import-runs-history";
import RunImportModal from "@/components/run-import-modal";

export default function ImportDataPanelShell() {
  const [show, setShow] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Import Data Panel</h1>

        <div className="flex items-center gap-2">
          <button
            className="rounded px-4 py-2 bg-blue-600 text-white"
            onClick={() => setShow(true)}
          >
            Run Import
          </button>
        </div>
      </div>

      <ImportRunsHistory refreshKey={refreshKey} />

      <RunImportModal
        open={show}
        onClose={() => setShow(false)}
        onCreated={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
