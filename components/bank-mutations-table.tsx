"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/** ================= Types ================= **/
type MutationKind =
  | "DEPOSIT" | "REVERSAL_DEPOSIT"
  | "WITHDRAWAL" | "REVERSAL_WITHDRAWAL"
  | "PENDING_DEPOSIT"
  | "INTERBANK_OUT" | "INTERBANK_IN"
  | "ADJUSTMENT"
  | "EXPENSE";

type BankMutationRow = {
  id: number;
  tenant_id: string;
  bank_id: number;
  deposit_id: number | null; // ref ke deposits/withdrawals (generic)
  kind: MutationKind;
  amount: number;
  balance_before: number;
  balance_after: number;
  txn_at: string;        // waktu dipilih (backdate)
  performed_at: string;  // waktu klik (real)
  description: string | null;
  created_by: string | null;
};

type BankLite = { id: number; bank_code: string; account_name: string; account_no: string; is_active: boolean; };
type DepositLite = { id: number; username: string; lead_id: number | null; performed_at: string };
type WithdrawalLite = { id: number; username: string; lead_id: number | null; performed_at: string };
type LeadLite = { id: number; name: string | null };
type ProfileLite = { user_id: string; full_name: string };

/** ================= Helpers ================= **/
const PAGE_SIZE = 50;

const CAT_OPTIONS = [
  { key: "ALL",          label: "All" },
  { key: "DEPO",         label: "Depo" },
  { key: "WD",           label: "WD" },
  { key: "PENDING_DP",   label: "Pending DP" },
  { key: "SESAMA_CM",    label: "Sesama CM" },
  { key: "ADJ",          label: "Adjustment" },
  { key: "EXPENSE",      label: "Expense" },          // khusus Expenses umum
  { key: "TRANSFER_FEE", label: "Biaya Transaksi" },  // EXPENSE fee (DP/WD/TT)
] as const;
type CatKey = typeof CAT_OPTIONS[number]["key"];

function kindsForCat(cat: CatKey): MutationKind[] | "EXPENSE_TRANSFER" | "ALL" {
  switch (cat) {
    case "DEPO":       return ["DEPOSIT", "REVERSAL_DEPOSIT"];
    case "WD":         return ["WITHDRAWAL", "REVERSAL_WITHDRAWAL"];
    case "PENDING_DP": return ["PENDING_DEPOSIT"];
    case "SESAMA_CM":  return ["INTERBANK_OUT", "INTERBANK_IN"];
    case "ADJ":        return ["ADJUSTMENT"];
    case "EXPENSE":    return ["EXPENSE"];          // nanti dipilah: BUKAN transfer fee
    case "TRANSFER_FEE": return "EXPENSE_TRANSFER"; // hanya fee
    default:           return "ALL";
  }
}
function startOfDayJakartaISO(d: string) {
  return new Date(`${d}T00:00:00+07:00`).toISOString();
}
function endOfDayJakartaISO(d: string) {
  return new Date(`${d}T23:59:59.999+07:00`).toISOString();
}
function todayJakartaYMD() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

// deteksi EXPENSE yang merupakan biaya transfer (WD/TT)
function isTransferFee(desc?: string | null) {
  if (!desc) return false;
  const s = desc.toLowerCase();
  return (
    s.includes("biaya transfer") ||
    s.includes("transfer fee") ||
    s.includes("fee transfer") ||
    s.includes("fee wd") ||
    s.includes("wd fee") ||
    s.includes("reversal wd fee") ||   // <— reversal fee
    s.includes("tt fee") ||
    s.includes("interbank fee")
  );
}

/** ================= Komponen ================= **/
export default function BankMutationsTable() {
  const supabase = supabaseBrowser();

  // data
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [rows, setRows] = useState<BankMutationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // lookups
  const [depositMap, setDepositMap] = useState<Record<number, DepositLite>>({});
  const [withdrawalMap, setWithdrawalMap] = useState<Record<number, WithdrawalLite>>({});
  const [leadMap, setLeadMap] = useState<Record<number, LeadLite>>({});
  const [creatorMap, setCreatorMap] = useState<Record<string, string>>({});

  // filters
  const [fId, setFId] = useState("");
  const [fStart, setFStart] = useState<string>(todayJakartaYMD());
  const [fFinish, setFFinish] = useState<string>(todayJakartaYMD());
  const [fCat, setFCat] = useState<CatKey>("ALL");
  const [fBankId, setFBankId] = useState<number | "">("");
  const [fDesc, setFDesc] = useState("");

  // load daftar bank tenant
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: prof } = await supabase
        .from("profiles").select("tenant_id").eq("user_id", user?.id).single();
      const t = prof?.tenant_id;
      if (t) {
        const { data } = await supabase
          .from("banks")
          .select("id, bank_code, account_name, account_no, is_active")
          .eq("tenant_id", t)
          .order("is_active", { ascending: false })
          .order("id", { ascending: false });
        setBanks((data as BankLite[]) ?? []);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // query utama
  const load = async (pageToLoad = page) => {
    setLoading(true);

    let q = supabase
      .from("bank_mutations")
      .select("*", { count: "exact" })
      .order("performed_at", { ascending: false })
      .order("id", { ascending: false }); // tie‑breaker stabil
      

    // Filter Waktu Click (REAL)
    if (fStart) q = q.gte("performed_at", startOfDayJakartaISO(fStart));
    if (fFinish) q = q.lte("performed_at", endOfDayJakartaISO(fFinish));

    // Filter ID
    if (fId.trim()) {
      const idn = Number(fId.trim());
      if (!Number.isNaN(idn)) q = q.eq("id", idn);
    }

    // Filter kategori
    const kinds = kindsForCat(fCat);
    if (Array.isArray(kinds)) q = q.in("kind", kinds);
    else if (kinds === "EXPENSE_TRANSFER") q = q.eq("kind", "EXPENSE");

    // Filter bank
    if (fBankId) q = q.eq("bank_id", Number(fBankId));

    // Filter desc
    if (fDesc.trim()) q = q.ilike("description", `%${fDesc.trim()}%`);

    // paging
    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error, count } = await q.range(from, to);
    if (error) { setLoading(false); alert(error.message); return; }

    // Pasca-filter Expense vs Biaya Transaksi
    let list = (data as BankMutationRow[]) ?? [];
    if (kinds === "EXPENSE_TRANSFER") {
      list = list.filter((r) => isTransferFee(r.description));
    } else if (Array.isArray(kinds) && kinds.length === 1 && kinds[0] === "EXPENSE" && fCat === "EXPENSE") {
      list = list.filter((r) => !isTransferFee(r.description)); // Expenses umum
    }

    // ---- Pairing WD + FEE (negatif) & REVERSAL_WD + FEE (positif) ----
    // (tanpa duplikasi & fee selalu tepat setelah pasangannya)
    if (fCat !== "TRANSFER_FEE") {
      const feeNegByRef = new Map<number, BankMutationRow>(); // WD Fee (amount < 0)
      const feePosByRef = new Map<number, BankMutationRow>(); // Reversal WD Fee (amount > 0)
      const wdIdsInPage = new Set<number>();
      const revWdIdsInPage = new Set<number>();

      for (const r of list) {
        if ((r.kind === "WITHDRAWAL") && r.deposit_id) wdIdsInPage.add(r.deposit_id);
        if ((r.kind === "REVERSAL_WITHDRAWAL") && r.deposit_id) revWdIdsInPage.add(r.deposit_id);
        if (r.kind === "EXPENSE" && isTransferFee(r.description) && r.deposit_id) {
          if (r.amount < 0) { if (!feeNegByRef.has(r.deposit_id)) feeNegByRef.set(r.deposit_id, r); }
          else if (r.amount > 0) { if (!feePosByRef.has(r.deposit_id)) feePosByRef.set(r.deposit_id, r); }
        }
      }

      const usedFeeIds = new Set<number>();
      const ordered: BankMutationRow[] = [];

      for (const r of list) {
        const isFee = r.kind === "EXPENSE" && isTransferFee(r.description) && !!r.deposit_id;

        if (isFee) {
          // Jika WD-nya ada di halaman ini → fee disisipkan setelah WD; skip di sini
          if (r.amount < 0 && wdIdsInPage.has(r.deposit_id!)) continue;
          // Jika Reversal WD-nya ada di halaman ini → fee reversal disisipkan setelah REV WD; skip di sini
          if (r.amount >= 0 && revWdIdsInPage.has(r.deposit_id!)) continue;
          // Jika pasangannya TIDAK ada di halaman, tampilkan fee apa adanya
          if (!usedFeeIds.has(r.id)) { ordered.push(r); usedFeeIds.add(r.id); }
          continue;
        }

        // tampilkan baris non-fee
        ordered.push(r);

        // sisipkan fee sesuai jenis transaksi
        if ((r.kind === "WITHDRAWAL") && r.deposit_id) {
          const fee = feeNegByRef.get(r.deposit_id);
          if (fee && !usedFeeIds.has(fee.id)) { ordered.push(fee); usedFeeIds.add(fee.id); }
        }
        if ((r.kind === "REVERSAL_WITHDRAWAL") && r.deposit_id) {
          const fee = feePosByRef.get(r.deposit_id);
          if (fee && !usedFeeIds.has(fee.id)) { ordered.push(fee); usedFeeIds.add(fee.id); }
        }
      }

      list = ordered;
    }

    setRows(list);
    setTotal(count ?? list.length);
    setPage(pageToLoad);

    // lookups batch: deposits + withdrawals + creator + lead
    const refIds = Array.from(new Set(list.map(r => r.deposit_id).filter((v): v is number => !!v)));
    const creatorIds = Array.from(new Set(list.map(r => r.created_by).filter((v): v is string => !!v)));

    const [depRes, wdRes, profRes] = await Promise.all([
      refIds.length
        ? supabase.from("deposits").select("id, username, lead_id, performed_at").in("id", refIds)
        : Promise.resolve({ data: [] as any[] }),
      refIds.length
        ? supabase.from("withdrawals").select("id, username, lead_id, performed_at").in("id", refIds)
        : Promise.resolve({ data: [] as any[] }),
      creatorIds.length
        ? supabase.from("profiles").select("user_id, full_name").in("user_id", creatorIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const depList = (depRes.data as DepositLite[]) ?? [];
    const wdList  = (wdRes.data as WithdrawalLite[]) ?? [];
    setDepositMap(Object.fromEntries(depList.map(d => [d.id, d])));
    setWithdrawalMap(Object.fromEntries(wdList.map(d => [d.id, d])));

    const leadIds = Array.from(new Set(
      [...depList.map(d => d.lead_id), ...wdList.map(w => w.lead_id)].filter((v): v is number => !!v)
    ));
    const leadList = leadIds.length
      ? ((await supabase.from("leads").select("id, name").in("id", leadIds)).data as LeadLite[] ?? [])
      : [];
    setLeadMap(Object.fromEntries(leadList.map(l => [l.id, l])));

    const profList = (profRes.data as ProfileLite[]) ?? [];
    setCreatorMap(Object.fromEntries(profList.map(p => [p.user_id, p.full_name])));

    setLoading(false);
  };

  useEffect(() => { load(1); /* initial */ }, []); // eslint-disable-line

  const bankLabel = (id: number) => {
    const b = banks.find(x => x.id === id);
    if (!b) return "[]";
    return `[${b.bank_code}] ${b.account_name} - ${b.account_no}`;
  };

  // ===== Cat kolom: EXPENSE transfer fee → "Biaya Transaksi"
  const catLabelForRow = (r: BankMutationRow): string => {
    if (r.kind === "DEPOSIT" || r.kind === "REVERSAL_DEPOSIT") return "Depo";
    if (r.kind === "WITHDRAWAL" || r.kind === "REVERSAL_WITHDRAWAL") return "WD";
    if (r.kind === "PENDING_DEPOSIT") return "Pending DP";
    if (r.kind === "INTERBANK_OUT" || r.kind === "INTERBANK_IN") return "Sesama CM";
    if (r.kind === "ADJUSTMENT") return "Adjustment";
    if (r.kind === "EXPENSE") {
      return isTransferFee(r.description) ? "Biaya Transaksi" : "Expense";
    }
    return "-";
  };

  // ===== Info tambahan (username/lead + wording)
  const extraInfo = (r: BankMutationRow): string => {
    if (r.kind === "DEPOSIT") {
      const d = r.deposit_id ? depositMap[r.deposit_id] : undefined;
      const leadName = d?.lead_id ? (leadMap[d.lead_id!]?.name ?? "") : "";
      return `Depo dari ${d?.username ?? "-"}${leadName ? " / " + leadName : ""}`;
    }
    if (r.kind === "REVERSAL_DEPOSIT") {
      const d = r.deposit_id ? depositMap[r.deposit_id] : undefined;
      const leadName = d?.lead_id ? (leadMap[d.lead_id!]?.name ?? "") : "";
      return `Reversal Depo dari ${d?.username ?? "-"}${leadName ? " / " + leadName : ""}`;
    }
    if (r.kind === "WITHDRAWAL") {
      const w = r.deposit_id ? withdrawalMap[r.deposit_id] : undefined;
      const leadName = w?.lead_id ? (leadMap[w.lead_id!]?.name ?? "") : "";
      return `WD ke ${w?.username ?? "-"}${leadName ? " / " + leadName : ""}`;
    }
    if (r.kind === "REVERSAL_WITHDRAWAL") {
      const w = r.deposit_id ? withdrawalMap[r.deposit_id] : undefined;
      const leadName = w?.lead_id ? (leadMap[w.lead_id!]?.name ?? "") : "";
      return `Reversal WD dari ${w?.username ?? "-"}${leadName ? " / " + leadName : ""}`;
    }
    if (r.kind === "EXPENSE" && isTransferFee(r.description)) {
      const s = (r.description || "").toLowerCase();
      if (s.includes("wd")) {
        const w = r.deposit_id ? withdrawalMap[r.deposit_id] : undefined;
        const base = s.includes("reversal") ? "Reversal Fee WD dari" : "Fee WD dari";
        return `${base} ${w?.username ?? "-"}`;
      }
      if (s.includes("tt") || s.includes("interbank")) {
        const b = banks.find(x => x.id === r.bank_id);
        return `Fee Sesama CM dari ${b ? `[${b.bank_code}] ${b.account_name}` : "-"}`;
      }
      return `Biaya Transfer`;
    }
    return r.description ?? "-";
  };

  // ===== Tag [REVERSAL-<performed_at_asli>] khusus baris reversal
  const reversalTag = (r: BankMutationRow) => {
    if (r.kind === "REVERSAL_DEPOSIT") {
      const d = r.deposit_id ? depositMap[r.deposit_id] : undefined;
      const madeAt = d?.performed_at
        ? new Date(d.performed_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
        : "-";
      return `[REVERSAL-${madeAt}]`;
    }
    if (r.kind === "REVERSAL_WITHDRAWAL") {
      const w = r.deposit_id ? withdrawalMap[r.deposit_id] : undefined;
      const madeAt = w?.performed_at
        ? new Date(w.performed_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
        : "-";
      return `[REVERSAL-${madeAt}]`;
    }
    return null;
  };

  const totalPagesTxt = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="rounded border bg-white p-3">
        <b>Bank Mutations</b>
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1250px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* ===== FILTER BAR ===== */}
            <tr className="filters">
              {/* ID */}
              <th className="w-24">
                <div className="text-xs text-gray-500">Cari ID</div>
                <input
                  value={fId}
                  onChange={(e) => setFId(e.target.value)}
                  className="w-full border rounded px-2 py-1"
                  placeholder="ID"
                />
              </th>

              {/* WAKTU CLICK start/finish */}
              <th className="w-56">
                <div className="flex flex-col gap-1">
                  <input
                    type="date"
                    value={fStart}
                    onChange={(e) => setFStart(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Start (Click)"
                  />
                  <input
                    type="date"
                    value={fFinish}
                    onChange={(e) => setFFinish(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Finish (Click)"
                  />
                </div>
              </th>

              {/* Waktu Dipilih — tidak difilter */}
              <th className="w-56"></th>

              {/* Cat */}
              <th className="w-36">
                <select
                  value={fCat}
                  onChange={(e) => setFCat(e.target.value as any)}
                  className="w-full border rounded px-2 py-1"
                >
                  {CAT_OPTIONS.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </th>

              {/* Bank */}
              <th className="min-w-[320px]">
                <select
                  value={fBankId === "" ? "" : String(fBankId)}
                  onChange={(e) => setFBankId(e.target.value ? Number(e.target.value) : "")}
                  className="w-full border rounded px-2 py-1"
                >
                  <option value="">All</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      [{b.bank_code}] {b.account_name} - {b.account_no}
                      {!b.is_active ? " (OFF)" : ""}
                    </option>
                  ))}
                </select>
              </th>

              {/* Desc */}
              <th className="w-56">
                <input
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  className="w-full border rounded px-2 py-1"
                  placeholder="Desc"
                />
              </th>

              {/* Amount / Start / Finish: no filters */}
              <th className="w-24"></th>
              <th className="w-24"></th>
              <th className="w-24"></th>

              {/* Submit */}
              <th className="w-28">
                <button onClick={() => load(1)} className="rounded bg-blue-600 text-white px-3 py-1">
                  submit
                </button>
              </th>
            </tr>

            {/* ===== HEADER ===== */}
            <tr>
              <th className="text-left w-24">ID</th>
              <th className="text-left w-56">Waktu Click</th>
              <th className="text-left w-56">Waktu Dipilih</th>
              <th className="text-left w-28">Cat</th>
              <th className="text-left min-w-[320px]">Bank</th>
              <th className="text-left w-60">Desc</th>
              <th className="text-right w-32">Amount</th>
              <th className="text-right w-40">Start</th>
              <th className="text-right w-40">Finish</th>
              <th className="text-left w-40">Creator</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr><td colSpan={10}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10}>No data</td></tr>
            ) : (
              rows.map((r) => {
                const creator = (r.created_by && creatorMap[r.created_by]) || r.created_by || "-";
                const tag = reversalTag(r);
                return (
                  <tr key={r.id} className="align-top">
                    <td>{r.id}</td>
                    <td>{new Date(r.performed_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                    <td>{new Date(r.txn_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                    <td>{catLabelForRow(r)}</td>
                    <td className="whitespace-normal break-words">
                      <div className="font-semibold">
                        {bankLabel(r.bank_id)}{" "}
                        <span className="text-gray-500">{tag}</span>
                      </div>
                      <div className="my-1 h-px bg-gray-200" />
                      <div className="text-sm text-gray-700">{extraInfo(r)}</div>
                    </td>
                    <td className="whitespace-normal break-words">{r.description ?? ""}</td>
                    <td className="text-right">{formatAmount(r.amount)}</td>
                    <td className="text-right">{formatAmount(r.balance_before)}</td>
                    <td className="text-right">{formatAmount(r.balance_after)}</td>
                    <td>{creator}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* PAGINATION */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button onClick={() => page > 1 && load(1)} disabled={page <= 1} className="px-3 py-1 rounded border bg-white disabled:opacity-50">First</button>
          <button onClick={() => page > 1 && load(page - 1)} disabled={page <= 1} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Previous</button>
          <span className="px-3 py-1 rounded border bg-white">Page {page} / {totalPagesTxt}</span>
          <button onClick={() => page < totalPages && load(page + 1)} disabled={page >= totalPages} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Next</button>
          <button onClick={() => page < totalPages && load(totalPages)} disabled={page >= totalPages} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Last</button>
        </nav>
      </div>
    </div>
  );
}
