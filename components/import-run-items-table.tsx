// components/import-run-items-table.tsx
"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { formatAmount } from "@/lib/format";

type ItemStatus = "MATCHED" | "LEBIH_BRACKET" | "LEBIH_PANEL";

export type ImportRunItemRow = {
  username: string;

  panel_total_amount: number;
  bracket_total_amount: number;
  diff_amount: number;

  panel_cnt: number;
  bracket_cnt: number;

  status: ItemStatus;
};

type ViewKey = "all" | "matched" | "missing" | "lebih_bracket" | "lebih_panel";

function statusLabel(s: ItemStatus) {
  if (s === "MATCHED") return "MATCHED";
  if (s === "LEBIH_BRACKET") return "LEBIH BRACKET";
  return "LEBIH PANEL";
}

function statusTone(s: ItemStatus) {
  if (s === "MATCHED") return "bg-green-50 text-green-700 border-green-200";
  if (s === "LEBIH_BRACKET") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

function diffText(n: number) {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${formatAmount(Math.abs(n))}`;
}

export default function ImportRunItemsTable({ items }: { items: ImportRunItemRow[] }) {
  // draft (belum apply)
  const [draftView, setDraftView] = useState<ViewKey>("all");
  const [draftSearch, setDraftSearch] = useState("");

  // applied (baru dipakai untuk filter)
  const [view, setView] = useState<ViewKey>("all");
  const [search, setSearch] = useState("");

  const stats = useMemo(() => {
    const total = items.length;
    const matched = items.filter((x) => x.status === "MATCHED").length;
    const lebihBracket = items.filter((x) => x.status === "LEBIH_BRACKET").length;
    const lebihPanel = items.filter((x) => x.status === "LEBIH_PANEL").length;
    const missing = total - matched;
    return { total, matched, missing, lebihBracket, lebihPanel };
  }, [items]);

  const filtered = useMemo(() => {
    let out = items;

    if (view === "matched") out = out.filter((x) => x.status === "MATCHED");
    if (view === "missing") out = out.filter((x) => x.status !== "MATCHED");
    if (view === "lebih_bracket") out = out.filter((x) => x.status === "LEBIH_BRACKET");
    if (view === "lebih_panel") out = out.filter((x) => x.status === "LEBIH_PANEL");

    const q = search.trim().toLowerCase();
    if (q) out = out.filter((x) => (x.username || "").toLowerCase().includes(q));

    return out;
  }, [items, view, search]);

  function apply() {
    setView(draftView);
    setSearch(draftSearch);
  }

  function clear() {
    setDraftView("all");
    setDraftSearch("");
    setView("all");
    setSearch("");
  }

  return (
    <div className="rounded border bg-white">
      <div className="p-3 border-b flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold">Matching (Sum per Username)</div>
          <div className="text-xs text-gray-600">
            Users: {stats.total} • Matched: {stats.matched} • Missing: {stats.missing} • Lebih Bracket:{" "}
            {stats.lebihBracket} • Lebih Panel: {stats.lebihPanel}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="rounded border px-2 py-2 text-sm"
            value={draftView}
            onChange={(e) => setDraftView(e.target.value as ViewKey)}
          >
            <option value="all">All</option>
            <option value="matched">Matched</option>
            <option value="missing">Missing</option>
            <option value="lebih_bracket">Lebih Bracket</option>
            <option value="lebih_panel">Lebih Panel</option>
          </select>

          <input
            className="rounded border px-3 py-2 text-sm w-64"
            placeholder="Search username..."
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                apply();
              }
            }}
          />

          <button
            type="button"
            className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={apply}
          >
            Submit
          </button>

          <button
            type="button"
            className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={clear}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="table-grid w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Username</th>
              <th className="text-right">Panel Total</th>
              <th className="text-right">Bracket Total</th>
              <th className="text-right">Diff</th>
              <th className="text-left">Status</th>
              <th className="text-right">Panel Cnt</th>
              <th className="text-right">Bracket Cnt</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((r) => {
              const diff = Number(r.diff_amount ?? 0);
              const diffClass =
                diff === 0 ? "text-gray-700" : diff > 0 ? "text-amber-700" : "text-rose-700";

              return (
                <tr key={r.username}>
                  <td className="font-medium">{r.username}</td>
                  <td className="text-right font-mono">{formatAmount(r.panel_total_amount)}</td>
                  <td className="text-right font-mono">{formatAmount(r.bracket_total_amount)}</td>
                  <td className={clsx("text-right font-mono", diffClass)}>{diffText(diff)}</td>
                  <td>
                    <span
                      className={clsx(
                        "inline-flex items-center rounded border px-2 py-1 text-xs font-medium",
                        statusTone(r.status),
                      )}
                    >
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="text-right">{r.panel_cnt}</td>
                  <td className="text-right">{r.bracket_cnt}</td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-500">
                  No data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
