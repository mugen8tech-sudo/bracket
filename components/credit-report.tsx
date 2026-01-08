"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

function startOfTodayLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function endOfTodayLocal() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

type ReportRow = {
  dp_count: number;
  wd_count: number;
  trx_total: number;
  credit_bonus: number;
  credit_in: number;
  credit_out: number;
  credit_balance: number;
};

export default function CreditReport() {
  const supabase = supabaseBrowser();
  const [tenantId, setTenantId] = useState<string>("");
  const [start, setStart] = useState<string>(startOfTodayLocal());
  const [finish, setFinish] = useState<string>(endOfTodayLocal());
  const [loading, setLoading] = useState<boolean>(false);
  const [r, setR] = useState<ReportRow | null>(null);
  const [tenantName, setTenantName] = useState<string>("");

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: prof } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", user?.id)
        .single();

      const tid = prof?.tenant_id ?? "";
      setTenantId(tid);

      if (tid) {
        const { data: tenant } = await supabase
          .from("tenants")
          .select("name")
          .eq("id", tid)
          .single();
        setTenantName(tenant?.name ?? "");
      }
    })();
  }, [supabase]);

  const submit = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("app_get_credit_report", {
      p_tenant_id: tenantId,
      p_start: new Date(start).toISOString(),
      p_finish: new Date(finish).toISOString(),
    });
    setLoading(false);
    if (error) {
      alert(error.message);
      return;
    }
    setR(
      (data && data[0]) || {
        dp_count: 0,
        wd_count: 0,
        trx_total: 0,
        credit_bonus: 0,
        credit_in: 0,
        credit_out: 0,
        credit_balance: 0,
      }
    );
  };

  // auto load default (hari ini)
  useEffect(() => {
    submit();
    /* eslint-disable-next-line */
  }, [tenantId]);

  // ✅ Enter = submit di Start/Finish
  const onDateEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submit();
  };

  return (
    <div className="space-y-3">
      <div className="text-lg font-semibold">Credit Reports — {tenantName}</div>
      <div className="overflow-auto rounded border bg-white">
        <div className="p-3 border-b flex items-center gap-2">
          <div className="flex items-center gap-2">
            <label className="text-sm">Start</label>
            <input
              type="datetime-local"
              step="1"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              onKeyDown={onDateEnter}
              className="border rounded px-2 py-1"
            />
          </div>
          <div className="flex items-center gap-2 ml-4">
            <label className="text-sm">Finish</label>
            <input
              type="datetime-local"
              step="1"
              value={finish}
              onChange={(e) => setFinish(e.target.value)}
              onKeyDown={onDateEnter}
              className="border rounded px-2 py-1"
            />
          </div>
          <button
            onClick={submit}
            disabled={loading}
            className="ml-auto h-8 min-w-[80px] px-3 rounded bg-blue-600 text-white disabled:opacity-60"
          >
            {loading ? "loading…" : "submit"}
          </button>
        </div>

        <table className="table-grid w-full">
          <thead>
            <tr>
              <th className="text-left w-1/2">Label</th>
              <th className="text-left w-1/2">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td># DP</td>
              <td>{r?.dp_count ?? 0}</td>
            </tr>
            <tr>
              <td># WD</td>
              <td>{r?.wd_count ?? 0}</td>
            </tr>
            <tr>
              <td># Trx Total</td>
              <td>{r?.trx_total ?? 0}</td>
            </tr>
            <tr>
              <td>Credit Bonus</td>
              <td>{formatAmount(r?.credit_bonus ?? 0)}</td>
            </tr>
            <tr>
              <td>Credit In</td>
              <td>{formatAmount(r?.credit_in ?? 0)}</td>
            </tr>
            <tr>
              <td>Credit Out</td>
              <td>{formatAmount(r?.credit_out ?? 0)}</td>
            </tr>
            <tr>
              <td>Credit Balance</td>
              <td>{formatAmount(r?.credit_balance ?? 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
