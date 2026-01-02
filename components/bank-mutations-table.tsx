"use client";

import { useEffect, useState, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/** ================= Types ================= **/
type MutationKind =
  | "DEPOSIT" | "REVERSAL_DEPOSIT"
  | "WITHDRAWAL" | "REVERSAL_WITHDRAWAL"
  | "PENDING_DEPOSIT" | "REVERSAL_PENDING_DEPOSIT"
  | "INTERBANK_OUT" | "INTERBANK_IN"
  | "ADJUSTMENT"
  | "EXPENSE"         // transfer fee (legacy)
  | "BANK_EXPENSE"   // expense operasional (baru)
  | "SETTLEMENT";

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

type BankLite = {
  id: number;
  bank_code: string;
  account_name: string;
  account_no: string;
  is_active: boolean;
};

type DepositLite = {
  id: number;
  username: string;
  lead_id: number | null;
  performed_at: string;
  description: string | null;

  // NEW (untuk detail di kolom Amount)
  amount_gross: number | string;
  fee_amount: number | string;
  amount_net: number | string;
};

type WithdrawalLite = {
  id: number;
  username: string;
  lead_id: number | null;
  performed_at: string;
  description: string | null;
};

type LeadLite = { id: number; name: string | null };
type ProfileLite = { user_id: string; full_name: string };

/** ================= Helpers ================= **/
const PAGE_SIZE = 25;

const CAT_OPTIONS = [
  { key: "ALL",          label: "All" },
  { key: "DEPO",         label: "Depo" },
  { key: "WD",           label: "WD" },
  { key: "PENDING_DP",   label: "Pending DP" },
  { key: "SESAMA_CM",    label: "Sesama CM" },
  { key: "ADJ",          label: "Adjustment" },
  { key: "EXPENSE",      label: "Expense" },          // khusus Expenses umum
  { key: "TRANSFER_FEE", label: "Biaya Transaksi" },  // EXPENSE fee (DP/WD/TT)
  { key: "AKURAN",       label: "Akuran" },
] as const;
type CatKey = (typeof CAT_OPTIONS)[number]["key"];

function kindsForCat(cat: CatKey): MutationKind[] | "EXPENSE_TRANSFER" | "ALL" {
  switch (cat) {
    case "DEPO":
      return ["DEPOSIT", "REVERSAL_DEPOSIT"];
    case "WD":
      return ["WITHDRAWAL", "REVERSAL_WITHDRAWAL"];
    case "PENDING_DP":
      return [
        "PENDING_DEPOSIT",
        "REVERSAL_PENDING_DEPOSIT",
        "REVERSAL_DEPOSIT",
      ]; // ambil dulu, nanti pasca-filter
    case "SESAMA_CM":
      return ["INTERBANK_OUT", "INTERBANK_IN"];
    case "ADJ":
      return ["ADJUSTMENT"];
    case "AKURAN":
      return ["SETTLEMENT"];
    case "EXPENSE":
      return ["BANK_EXPENSE"]; // Expense operasional
    case "TRANSFER_FEE":
      return "EXPENSE_TRANSFER"; // HANYA fee (EXPENSE)
    default:
      return "ALL";
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
function isTtFee(desc?: string | null) {
  if (!desc) return false;
  const s = desc.toLowerCase();
  return s.includes("tt fee") || s.includes("interbank fee");
}
function isTransferFee(desc?: string | null) {
  if (!desc) return false;
  const s = desc.toLowerCase();
  return (
    s.includes("biaya transfer") ||
    s.includes("transfer fee") ||
    s.includes("fee transfer") ||
    s.includes("fee wd") ||
    s.includes("wd fee") ||
    s.includes("reversal wd fee") || // <— reversal fee
    s.includes("tt fee") ||
    s.includes("interbank fee")
  );
}

// dd/mm/yyyy hh.mm.ss (Asia/Jakarta)
function formatIdDateTime(d: string | Date | null | undefined) {
  if (!d) return "-";
  const dt = typeof d === "string" ? new Date(d) : d;
  const date = dt.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" });
  const time = dt
    .toLocaleTimeString("id-ID", { hour12: false, timeZone: "Asia/Jakarta" })
    .replace(/:/g, ".");
  return `${date} ${time}`;
}

// Parse "PDP-YYYY-MM-DD HH:mm:ss" → Date (WIB)
function parsePdpTimestamp(desc?: string | null): Date | null {
  if (!desc) return null;
  const m = desc.match(
    /PDP-([0-9]{4})-([0-9]{2})-([0-9]{2})\s+([0-9]{2}):([0-9]{2}):([0-9]{2})/i,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+07:00`);
}

// Ambil hanya "alasan" dari description reversal PDP.
// Jika desc generik (mis. "Reverse Pending Deposit"), kosongkan.
// Jika berisi alasan (mis. "SALAH INPUT" atau "Alasan: <teks>"), tampilkan alasannya saja.
function reasonFromReversalPdpDesc(desc?: string | null) {
  if (!desc) return "";
  const raw = desc.trim();
  const low = raw.toLowerCase();
  // buang frasa generik
  const generics = [
    "reverse pending deposit",
    "reversal pending deposit",
    "reverse pending dp",
    "reversal pending dp",
    "reverse pending depo",
    "reversal pending depo",
  ];
  if (generics.some((g) => low.includes(g))) {
    // jika ada "|", ambil sisi kanan sebagai alasan
    const afterPipe = raw.split("|")[1]?.trim();
    if (afterPipe) return afterPipe;
    // coba pola "alasan: xxx" / "reason: xxx"
    const m = raw.match(/(?:alasan|reason)\s*:\s*(.+)$/i);
    return m ? m[1].trim() : "";
  }
  // kalau bukan frasa generik (contoh "SALAH INPUT"), anggap itu alasan
  return raw;
}

// Pisahkan deskripsi settlement: "<note> | target: ..."
// return { note: "TES AKURAN", target: "target: OTHER TRC 20 / 123..." }
function splitSettlementMeta(raw?: string | null) {
  const s = (raw ?? "").trim();
  if (!s) return { note: "", target: "" };
  const m = s.match(/^(.*?)(?:\s*\|\s*(target\s*:\s*.+))?$/i);
  return { note: (m?.[1] ?? "").trim(), target: (m?.[2] ?? "").trim() };
}

/** ================= Komponen ================= **/
export default function BankMutationsTable() {
  const supabase = supabaseBrowser();

  const bankFilterInputRef = useRef<HTMLInputElement | null>(null);
  const bankFilterContainerRef = useRef<HTMLDivElement | null>(null);

  // data
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [rows, setRows] = useState<BankMutationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // lookups
  const [depositMap, setDepositMap] = useState<Record<number, DepositLite>>({});
  const [withdrawalMap, setWithdrawalMap] =
    useState<Record<number, WithdrawalLite>>({});
  const [leadMap, setLeadMap] = useState<Record<number, LeadLite>>({});
  const [creatorMap, setCreatorMap] = useState<Record<string, string>>({});
  const [ttDescMap, setTtDescMap] = useState<Record<number, string>>({});
  const [expDescMap, setExpDescMap] = useState<Record<number, string>>({});
  const [settleDescMap, setSettleDescMap] =
    useState<Record<number, string>>({});
  const [pdpDescMap, setPdpDescMap] = useState<Record<number, string>>({});
  const [adjDescMap, setAdjDescMap] = useState<Record<number, string>>({});

  // mapping waktu PDP asal untuk reversal PDP (id reversal -> performed_at PDP asal)
  const [revPdpTimeMap, setRevPdpTimeMap] =
    useState<Record<number, string>>({});

  // filters
  const [fId, setFId] = useState("");
  const [fStart, setFStart] = useState<string>(todayJakartaYMD());
  const [fFinish, setFFinish] = useState<string>(todayJakartaYMD());
  const [fCat, setFCat] = useState<CatKey>("ALL");
  const [fBankId, setFBankId] = useState<number | "">("");
  const [fDesc, setFDesc] = useState("");

  const [fBankOpen, setFBankOpen] = useState(false);
  const [fBankSearch, setFBankSearch] = useState("");
  const [fBankIndex, setFBankIndex] = useState(0);

  // load daftar bank tenant
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

  // close dropdown filter bank saat klik di luar
  useEffect(() => {
    if (!fBankOpen) return;

    const handler = (e: MouseEvent) => {
      const container = bankFilterContainerRef.current;
      if (container && !container.contains(e.target as Node)) {
        setFBankOpen(false);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
    };
  }, [fBankOpen]);

  // query utama
  const load = async (pageToLoad = page) => {
      setLoading(true);

      // ==== Pre-calc: keyword Desc & BANK_EXPENSE IDs (public.bank_expenses.description) ====
      const descInput = fDesc.trim();
      const descKeywords = descInput
        ? descInput.split(/\s+/).filter(Boolean)
        : [];

      let bankExpenseIdsForDesc: number[] = [];

      if (descKeywords.length) {
        let qExp = supabase
          .from("bank_expenses")
          .select("mutation_id");

        for (const kw of descKeywords) {
          qExp = qExp.ilike("description", `%${kw}%`);
        }

        const { data: expRows, error: expErr } = await qExp;
        if (expErr) {
          setLoading(false);
          alert(expErr.message);
          return;
        }
        const expList = (expRows as any[]) ?? [];
        bankExpenseIdsForDesc = expList
          .map((row: any) => row.mutation_id as number | null)
          .filter((id): id is number => typeof id === "number");
      }

      let q = supabase
        .from("bank_mutations")
        .select("*", { count: "exact" })
        .order("performed_at", { ascending: false })
        .order("id", { ascending: false }); // tie-breaker stabil

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

    // Filter desc (multi-keyword, AND) – match either bank_mutations.description
    // atau khusus BANK_EXPENSE: public.bank_expenses.description
    if (descKeywords.length) {
      const descParts = descKeywords.map((kw) => `description.ilike.%${kw}%`);
      let orStr = `and(${descParts.join(",")})`;

      if (bankExpenseIdsForDesc.length) {
        const idList = bankExpenseIdsForDesc.join(",");
        orStr += `,id.in.(${idList})`;
      }

      q = q.or(orStr);
    }

    // paging
    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error, count } = await q.range(from, to);
    if (error) {
      setLoading(false);
      alert(error.message);
      return;
    }

    // Pasca-filter Expense vs Biaya Transaksi
    let list = (data as BankMutationRow[]) ?? [];
    if (kinds === "EXPENSE_TRANSFER") {
      list = list.filter((r) => isTransferFee(r.description));
    } else if (
      Array.isArray(kinds) &&
      kinds.length === 1 &&
      kinds[0] === "EXPENSE" &&
      fCat === "EXPENSE"
    ) {
      list = list.filter((r) => !isTransferFee(r.description)); // Expenses umum
    }

    // ---- Pairing WD + Fee (FEE DI ATAS WD) & REVERSAL_WD + Reversal Fee ----
    if (fCat !== "TRANSFER_FEE") {
      const feeNegByRef = new Map<number, BankMutationRow>(); // WD Fee (amount < 0)
      const feePosByRef = new Map<number, BankMutationRow>(); // Reversal WD Fee (amount > 0)
      const wdRefs = new Set<number>();
      const revWdRefs = new Set<number>();

      for (const r of list) {
        if (r.kind === "WITHDRAWAL" && r.deposit_id) wdRefs.add(r.deposit_id);
        if (r.kind === "REVERSAL_WITHDRAWAL" && r.deposit_id)
          revWdRefs.add(r.deposit_id);
        if (r.kind === "EXPENSE" && isTransferFee(r.description) && r.deposit_id) {
          if (r.amount < 0) feeNegByRef.set(r.deposit_id, r);
          else feePosByRef.set(r.deposit_id, r);
        }
      }

      const usedFeeIds = new Set<number>();
      const ordered: BankMutationRow[] = [];

      for (const r of list) {
        const isFee =
          r.kind === "EXPENSE" &&
          isTransferFee(r.description) &&
          !!r.deposit_id;

        if (isFee) {
          // Jika pasangan (WD/REV_WD) ada di halaman, fee akan disisipkan di sana (skip di sini)
          if (
            (r.amount < 0 && wdRefs.has(r.deposit_id!)) ||
            (r.amount >= 0 && revWdRefs.has(r.deposit_id!))
          ) {
            continue;
          }
          // Jika pasangannya tidak ada di halaman, tampilkan fee apa adanya
          if (!usedFeeIds.has(r.id)) {
            ordered.push(r);
            usedFeeIds.add(r.id);
          }
          continue;
        }

        // WD → taruh FEE dulu, baru WD
        if (r.kind === "WITHDRAWAL" && r.deposit_id) {
          const fee = feeNegByRef.get(r.deposit_id);
          if (fee && !usedFeeIds.has(fee.id)) {
            ordered.push(fee);
            usedFeeIds.add(fee.id);
          }
          ordered.push(r);
          continue;
        }

        // REVERSAL_WD → taruh FEE REVERSAL dulu, baru REV_WD
        if (r.kind === "REVERSAL_WITHDRAWAL" && r.deposit_id) {
          const fee = feePosByRef.get(r.deposit_id);
          if (fee && !usedFeeIds.has(fee.id)) {
            ordered.push(fee);
            usedFeeIds.add(fee.id);
          }
          ordered.push(r);
          continue;
        }

        // selain itu, render biasa
        ordered.push(r);
      }

      list = ordered;
    }

    // === Pairing waktu PDP asal untuk reversal PDP (berdasarkan data di halaman)
    const pdpRows = list.filter((r) => r.kind === "PENDING_DEPOSIT");
    const revCandidates = list.filter(
      (r) =>
        r.kind === "REVERSAL_PENDING_DEPOSIT" ||
        r.kind === "REVERSAL_DEPOSIT",
    );

    // bucket PENDING_DEPOSIT per (bank_id, |amount|), urut waktu naik
    const pdpBuckets = new Map<string, BankMutationRow[]>();
    for (const p of pdpRows) {
      const key = `${p.bank_id}|${Math.abs(p.amount)}`;
      const arr = pdpBuckets.get(key) || [];
      arr.push(p);
      pdpBuckets.set(key, arr);
    }
    for (const arr of pdpBuckets.values()) {
      arr.sort(
        (a, b) =>
          new Date(a.performed_at).getTime() -
          new Date(b.performed_at).getTime(),
      );
    }

    // cari pasangan PDP untuk tiap kandidat reversal
    const tmpRevMap: Record<number, string> = {};
    for (const rv of revCandidates) {
      const key = `${rv.bank_id}|${Math.abs(rv.amount)}`;
      const arr = pdpBuckets.get(key) || [];
      if (!arr.length) continue;
      const tRv = new Date(rv.performed_at).getTime();
      let picked: BankMutationRow | undefined;
      // ambil PDP terakhir yang waktunya <= waktu reversal
      for (let i = arr.length - 1; i >= 0; i--) {
        if (new Date(arr[i].performed_at).getTime() <= tRv) {
          picked = arr[i];
          break;
        }
      }
      if (picked) tmpRevMap[rv.id] = picked.performed_at;
    }
    setRevPdpTimeMap(tmpRevMap);

    // Jika user memilih kategori "Pending DP", saring reversal deposit yang bukan reversal PDP
    if (fCat === "PENDING_DP") {
      list = list.filter(
        (r) =>
          r.kind === "PENDING_DEPOSIT" ||
          r.kind === "REVERSAL_PENDING_DEPOSIT" ||
          !!tmpRevMap[r.id],
      );
    }

    // === ⬇️ Tambahan: penataan grup TT (OUT → Fee → IN ketika ascending) ===
    // Ambil semua ID mutasi di halaman
    const idsOnPage = list.map((r) => r.id);
    // Cari interbank_transfers yang mereferensikan salah satu ID tsb
    let ttRows: {
      id: number;
      mutation_out_id: number;
      mutation_in_id: number;
      mutation_fee_id: number | null;
    }[] = [];
    if (idsOnPage.length) {
      const [qOut, qIn] = await Promise.all([
        supabase
          .from("interbank_transfers")
          .select("id, mutation_out_id, mutation_in_id, mutation_fee_id")
          .in("mutation_out_id", idsOnPage),
        supabase
          .from("interbank_transfers")
          .select("id, mutation_out_id, mutation_in_id, mutation_fee_id")
          .in("mutation_in_id", idsOnPage),
      ]);
      ttRows = [...((qOut.data as any[]) ?? []), ...((qIn.data as any[]) ?? [])];
      // de-dupe by id
      const seen = new Set<number>();
      ttRows = ttRows.filter((r) =>
        seen.has(r.id) ? false : (seen.add(r.id), true),
      );
    }

    if (ttRows.length) {
      // peta: mutation_id -> { group info }
      const byMutId = new Map<
        number,
        { outId: number; inId: number; feeId: number | null }
      >();
      for (const t of ttRows) {
        byMutId.set(t.mutation_out_id, {
          outId: t.mutation_out_id,
          inId: t.mutation_in_id,
          feeId: t.mutation_fee_id ?? null,
        });
        byMutId.set(t.mutation_in_id, {
          outId: t.mutation_out_id,
          inId: t.mutation_in_id,
          feeId: t.mutation_fee_id ?? null,
        });
        if (t.mutation_fee_id)
          byMutId.set(t.mutation_fee_id, {
            outId: t.mutation_out_id,
            inId: t.mutation_in_id,
            feeId: t.mutation_fee_id,
          });
      }

      // index cepat id -> row
      const rowById = new Map<number, BankMutationRow>(
        list.map((r) => [r.id, r]),
      );
      const used = new Set<number>();
      const ordered: BankMutationRow[] = [];

      // Dengan urut default DESC (performed_at, id), kita jaga konsistensi global:
      // tampilkan IN → (Fee) → OUT. Saat user melihat urut ASC, hasilnya otomatis OUT → Fee → IN.
      for (const r of list) {
        if (used.has(r.id)) continue;

        const grp = byMutId.get(r.id);
        if (!grp) {
          ordered.push(r);
          used.add(r.id);
          continue;
        }

        // urut DESC: IN, Fee(optional), OUT
        const ids = [grp.inId, grp.feeId ?? undefined, grp.outId].filter(
          Boolean,
        ) as number[];
        for (const id of ids) {
          const it = rowById.get(id);
          if (it && !used.has(id)) {
            ordered.push(it);
            used.add(id);
          }
        }
      }

      list = ordered;
    }

    // === Ambil deskripsi TT yang dimasukkan user (untuk kolom Desc)
    const ttOutIds = list
      .filter((r) => r.kind === "INTERBANK_OUT")
      .map((r) => r.id);
    const ttInIds = list
      .filter((r) => r.kind === "INTERBANK_IN")
      .map((r) => r.id);
    const ttFeeIds = list
      .filter((r) => r.kind === "EXPENSE" && isTtFee(r.description))
      .map((r) => r.id);

    if (ttOutIds.length + ttInIds.length + ttFeeIds.length > 0) {
      const [qOut, qIn, qFee] = await Promise.all([
        ttOutIds.length
          ? supabase
              .from("interbank_transfers")
              .select("mutation_out_id, description")
              .in("mutation_out_id", ttOutIds)
          : Promise.resolve({ data: [] as any[] }),
        ttInIds.length
          ? supabase
              .from("interbank_transfers")
              .select("mutation_in_id, description")
              .in("mutation_in_id", ttInIds)
          : Promise.resolve({ data: [] as any[] }),
        ttFeeIds.length
          ? supabase
              .from("interbank_transfers")
              .select("mutation_fee_id, description")
              .in("mutation_fee_id", ttFeeIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const map: Record<number, string> = {};
      for (const r of ((qOut.data as any[]) ?? [])) {
        if (r.mutation_out_id) map[r.mutation_out_id] = r.description ?? "";
      }
      for (const r of ((qIn.data as any[]) ?? [])) {
        if (r.mutation_in_id) map[r.mutation_in_id] = r.description ?? "";
      }
      for (const r of ((qFee.data as any[]) ?? [])) {
        if (r.mutation_fee_id) map[r.mutation_fee_id] = r.description ?? "";
      }
      setTtDescMap(map);
    } else {
      setTtDescMap({});
    }

    // === Deskripsi khusus BANK_EXPENSE (operasional)
    const beIds = list
      .filter((r) => r.kind === "BANK_EXPENSE")
      .map((r) => r.id);
    if (beIds.length) {
      const { data } = await supabase
        .from("bank_expenses")
        .select("mutation_id, description")
        .in("mutation_id", beIds);
      const map: Record<number, string> = {};
      for (const it of ((data as any[]) ?? [])) {
        if (it.mutation_id) map[it.mutation_id] = it.description ?? "";
      }
      setExpDescMap(map);
    } else {
      setExpDescMap({});
    }

    // === Deskripsi Settlement (Akuran)
    const stIds = list
      .filter((r) => r.kind === "SETTLEMENT")
      .map((r) => r.id);
    if (stIds.length) {
      const { data } = await supabase
        .from("settlements")
        .select("mutation_id, description")
        .in("mutation_id", stIds);
      const map: Record<number, string> = {};
      for (const it of ((data as any[]) ?? [])) {
        if (it.mutation_id) map[it.mutation_id] = it.description ?? "";
      }
      setSettleDescMap(map);
    } else {
      setSettleDescMap({});
    }

    // === Deskripsi Pending Deposit
    const pdpMutIds = list
      .filter((r) => r.kind === "PENDING_DEPOSIT")
      .map((r) => r.id);
    if (pdpMutIds.length) {
      const { data } = await supabase
        .from("pending_deposits")
        .select("mutation_id, description")
        .in("mutation_id", pdpMutIds);
      const map: Record<number, string> = {};
      for (const it of ((data as any[]) ?? [])) {
        if (it.mutation_id) map[it.mutation_id] = it.description ?? "";
      }
      setPdpDescMap(map);
    } else {
      setPdpDescMap({});
    }

    // === Deskripsi Adjustment
    const adjMutIds = list
      .filter((r) => r.kind === "ADJUSTMENT")
      .map((r) => r.id);
    if (adjMutIds.length) {
      const { data } = await supabase
        .from("bank_adjustments")
        .select("mutation_id, description")
        .in("mutation_id", adjMutIds);
      const map: Record<number, string> = {};
      for (const it of ((data as any[]) ?? [])) {
        if (it.mutation_id) map[it.mutation_id] = it.description ?? "";
      }
      setAdjDescMap(map);
    } else {
      setAdjDescMap({});
    }

    setRows(list);
    setTotal(count ?? list.length);
    setPage(pageToLoad);

    // lookups batch: deposits + withdrawals + creator + lead
    const refIds = Array.from(
      new Set(
        list
          .map((r) => r.deposit_id)
          .filter((v): v is number => v !== null && v !== undefined),
      ),
    );
    const creatorIds = Array.from(
      new Set(
        list
          .map((r) => r.created_by)
          .filter((v): v is string => !!v),
      ),
    );

    const [depRes, wdRes, profRes] = await Promise.all([
      refIds.length
        ? supabase
            .from("deposits")
            .select("id, username, lead_id, performed_at, description, amount_gross, fee_amount, amount_net")
            .in("id", refIds)
        : Promise.resolve({ data: [] as any[] }),
      refIds.length
        ? supabase
            .from("withdrawals")
            .select("id, username, lead_id, performed_at, description")
            .in("id", refIds)
        : Promise.resolve({ data: [] as any[] }),
      creatorIds.length
        ? supabase
            .from("profiles")
            .select("user_id, full_name")
            .in("user_id", creatorIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const depList = (depRes.data as DepositLite[]) ?? [];
    const wdList = (wdRes.data as WithdrawalLite[]) ?? [];
    setDepositMap(Object.fromEntries(depList.map((d) => [d.id, d])));
    setWithdrawalMap(Object.fromEntries(wdList.map((d) => [d.id, d])));

    const leadIds = Array.from(
      new Set(
        [
          ...depList.map((d) => d.lead_id),
          ...wdList.map((w) => w.lead_id),
        ].filter((v): v is number => !!v),
      ),
    );
    const leadList =
      leadIds.length > 0
        ? (((await supabase
            .from("leads")
            .select("id, name")
            .in("id", leadIds)).data as LeadLite[]) ?? [])
        : [];
    setLeadMap(Object.fromEntries(leadList.map((l) => [l.id, l])));

    const profList = (profRes.data as ProfileLite[]) ?? [];
    setCreatorMap(Object.fromEntries(profList.map((p) => [p.user_id, p.full_name])));

    setLoading(false);
  };

  useEffect(() => {
    load(1); /* initial */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bankLabel = (id: number) => {
    const b = banks.find((x) => x.id === id);
    if (!b) return "[]";
    return `[${b.bank_code}] ${b.account_name} - ${b.account_no}`;
  };

  // helper: apakah baris ini adalah reversal dari Pending DP?
  const isReversalOfPDP = (r: BankMutationRow) =>
    r.kind === "REVERSAL_PENDING_DEPOSIT" || !!revPdpTimeMap[r.id];

  // ===== Cat kolom
  const catLabelForRow = (r: BankMutationRow): string => {
    if (r.kind === "WITHDRAWAL" || r.kind === "REVERSAL_WITHDRAWAL")
      return "WD";
    if (r.kind === "INTERBANK_OUT" || r.kind === "INTERBANK_IN")
      return "Sesama CM";
    if (r.kind === "ADJUSTMENT") return "Adjustment";
    if (r.kind === "BANK_EXPENSE") return "Expense";
    if (r.kind === "EXPENSE")
      return isTransferFee(r.description) ? "Biaya Transaksi" : "Expense";
    if (r.kind === "PENDING_DEPOSIT" || isReversalOfPDP(r)) return "Pending DP";
    if (r.kind === "DEPOSIT" || r.kind === "REVERSAL_DEPOSIT") return "Depo";
    if (r.kind === "SETTLEMENT") return "Akuran";
    return "-";
  };

  // ===== Info tambahan (username/lead + wording)
  const extraInfo = (r: BankMutationRow): string => {
    if (r.kind === "SETTLEMENT") {
      const raw = settleDescMap[r.id] ?? r.description ?? "";
      const { target } = splitSettlementMeta(raw);
      return target || "";
    }
    if (r.kind === "DEPOSIT") {
      const d = r.deposit_id ? depositMap[r.deposit_id] : undefined;
      const leadName = d?.lead_id ? leadMap[d.lead_id!]?.name ?? "" : "";
      return `Depo dari ${d?.username ?? "-"}${
        leadName ? " / " + leadName : ""
      }`;
    }
    if (isReversalOfPDP(r)) {
      return "Reversal Pending DP";
    }
    if (r.kind === "REVERSAL_DEPOSIT") {
      const d = r.deposit_id ? depositMap[r.deposit_id] : undefined;
      const leadName = d?.lead_id ? leadMap[d.lead_id!]?.name ?? "" : "";
      return `Reversal Depo dari ${d?.username ?? "-"}${
        leadName ? " / " + leadName : ""
      }`;
    }
    if (r.kind === "WITHDRAWAL") {
      const w = r.deposit_id ? withdrawalMap[r.deposit_id] : undefined;
      const leadName = w?.lead_id ? leadMap[w.lead_id!]?.name ?? "" : "";
      return `WD ke ${w?.username ?? "-"}${
        leadName ? " / " + leadName : ""
      }`;
    }
    if (r.kind === "REVERSAL_WITHDRAWAL") {
      const w = r.deposit_id ? withdrawalMap[r.deposit_id] : undefined;
      const leadName = w?.lead_id ? leadMap[w.lead_id!]?.name ?? "" : "";
      return `Reversal WD dari ${w?.username ?? "-"}${
        leadName ? " / " + leadName : ""
      }`;
    }
    if (r.kind === "EXPENSE" && isTransferFee(r.description)) {
      const s = (r.description || "").toLowerCase();

      // WD fee (tetap)
      if (s.includes("wd")) {
        const w = r.deposit_id ? withdrawalMap[r.deposit_id] : undefined;
        const base = s.includes("reversal")
          ? "Reversal Fee WD dari"
          : "Fee WD dari";
        return `${base} ${w?.username ?? "-"}`;
      }

      // Fee Akuran
      if (/\bsettlement\b/i.test(s)) {
        const b = banks.find((x) => x.id === r.bank_id);
        return `Fee Akuran dari ${
          b ? `[${b.bank_code}] ${b.account_name}` : "-"
        }`;
      }

      // Fee Sesama CM (TT)
      if (isTtFee(r.description)) {
        const b = banks.find((x) => x.id === r.bank_id);
        return `Fee Sesama CM dari ${
          b ? `[${b.bank_code}] ${b.account_name}` : "-"
        }`;
      }

      return "Biaya Transfer";
    }
    return r.description ?? "-";
  };

  // ===== Tag [REVERSAL-<performed_at_asli>] khusus baris reversal
  const reversalTag = (r: BankMutationRow) => {
    if (isReversalOfPDP(r)) {
      const madeAt = revPdpTimeMap[r.id]
        ? formatIdDateTime(revPdpTimeMap[r.id])
        : "-";
      return `[REVERSAL-${madeAt}]`;
    }
    if (r.kind === "REVERSAL_DEPOSIT") {
      const d = r.deposit_id ? depositMap[r.deposit_id] : undefined;
      const madeAt = d?.performed_at
        ? formatIdDateTime(d.performed_at)
        : "-";
      return `[REVERSAL-${madeAt}]`;
    }
    if (r.kind === "REVERSAL_WITHDRAWAL") {
      const w = r.deposit_id ? withdrawalMap[r.deposit_id] : undefined;
      const madeAt = w?.performed_at
        ? formatIdDateTime(w.performed_at)
        : "-";
      return `[REVERSAL-${madeAt}]`;
    }
    return null;
  };

  // Tag PDP (untuk DEPOSIT hasil assign) → format dd/mm/yyyy hh.mm.ss
  const pdpTag = (r: BankMutationRow) => {
    if (r.kind !== "DEPOSIT") return null;
    const d = parsePdpTimestamp(r.description);
    if (!d) return null;
    return `[PDP-${formatIdDateTime(d)}]`;
  };

  // Desc dasar:
  // - DEPOSIT hasil assign PDP → kosong
  // - Reversal PDP → hanya "alasan"
  // - lainnya → description apa adanya
  const descForRow = (r: BankMutationRow, pdpTagStr: string | null) => {
    if (r.kind === "DEPOSIT" && pdpTagStr) return "";
    if (isReversalOfPDP(r)) return reasonFromReversalPdpDesc(r.description);
    return r.description ?? "";
  };

  // Effective description untuk kolom "Desc" dengan prioritas 7 tabel → fallback bank_mutations
  const displayDescForRow = (r: BankMutationRow, pdpTagStr: string | null) => {
    // 1) Settlement / Akuran → note dari settlements
    if (r.kind === "SETTLEMENT") {
      const raw = settleDescMap[r.id] ?? r.description ?? "";
      const { note } = splitSettlementMeta(raw);
      return note;
    }

    // 2) Interbank & Fee TT → desc dari interbank_transfers, fallback ke generic
    if (
      r.kind === "INTERBANK_OUT" ||
      r.kind === "INTERBANK_IN" ||
      (r.kind === "EXPENSE" && isTransferFee(r.description))
    ) {
      const fromTt = ttDescMap[r.id];
      if (fromTt) return fromTt;
      return descForRow(r, pdpTagStr);
    }

    // 3) Bank Expense operasional → bank_expenses.description
    if (r.kind === "BANK_EXPENSE") {
      const fromExp = expDescMap[r.id];
      if (fromExp) return fromExp;
      return descForRow(r, pdpTagStr);
    }

    // 4) Pending Deposit → pending_deposits.description
    if (
      r.kind === "PENDING_DEPOSIT" ||
      r.kind === "REVERSAL_PENDING_DEPOSIT"
    ) {
      const fromPdp = pdpDescMap[r.id];
      if (fromPdp) return fromPdp;
      return descForRow(r, pdpTagStr);
    }

    // 5) Adjustment → bank_adjustments.description
    if (r.kind === "ADJUSTMENT") {
      const fromAdj = adjDescMap[r.id];
      if (fromAdj) return fromAdj;
      return descForRow(r, pdpTagStr);
    }

    // 6) Deposit / Reversal Deposit → deposits.description
    if (r.kind === "DEPOSIT" || r.kind === "REVERSAL_DEPOSIT") {
      if (r.kind === "DEPOSIT" && pdpTagStr) {
        // DEPOSIT hasil assign PDP tetap kosong (info sudah di tag)
        return "";
      }
      const d = r.deposit_id ? depositMap[r.deposit_id] : undefined;
      if (d?.description) return d.description;
      return descForRow(r, pdpTagStr);
    }

    // 7) Withdrawal / Reversal Withdrawal → withdrawals.description
    if (r.kind === "WITHDRAWAL" || r.kind === "REVERSAL_WITHDRAWAL") {
      const w = r.deposit_id ? withdrawalMap[r.deposit_id] : undefined;
      if (w?.description) return w.description;
      return descForRow(r, pdpTagStr);
    }

    // fallback default
    return descForRow(r, pdpTagStr);
  };

  const totalPagesTxt = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="rounded border bg-white p-3">
        <b>Bank Mutations</b>
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table
          className="table-grid min-w-[1250px]"
          style={{ borderCollapse: "collapse" }}
        >
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
              <th className="w-56" />

              {/* Cat */}
              <th className="w-36">
                <select
                  value={fCat}
                  onChange={(e) => setFCat(e.target.value as CatKey)}
                  className="w-full border rounded px-2 py-1"
                >
                  {CAT_OPTIONS.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </th>

              {/* Bank */}
              <th className="min-w-[320px]">
                <div
                  className="relative"
                  ref={bankFilterContainerRef}
                >
                  {/* Tombol utama */}
                  <button
                    type="button"
                    className="w-full border rounded px-2 py-1 text-left"
                    onClick={() => {
                      const willOpen = !fBankOpen;
                      setFBankOpen(willOpen);
                      if (willOpen) {
                        setFBankSearch("");
                        setFBankIndex(0);
                        setTimeout(() => {
                          bankFilterInputRef.current?.focus();
                        }, 0);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className={fBankId === "" ? "text-gray-500" : ""}>
                        {fBankId === ""
                          ? "All"
                          : bankLabel(Number(fBankId))}
                      </span>
                      <span className="ml-2">▾</span>
                    </div>
                  </button>

                  {/* Panel dropdown */}
                  {fBankOpen && (
                    <div className="absolute z-10 mt-1 w-full border bg-white rounded shadow">
                      {/* Search di dalam dropdown */}
                      <div className="p-2 border-b">
                        <input
                          ref={bankFilterInputRef}
                          className="border rounded px-3 py-2 w-full"
                          placeholder="search bank…"
                          value={fBankSearch}
                          onChange={(e) => {
                            setFBankSearch(e.target.value);
                            setFBankIndex(0); // highlight ke item pertama
                          }}
                          onKeyDown={(e) => {
                            e.stopPropagation();

                            const kw = fBankSearch.trim().toLowerCase();
                            const allItems: { id: number | ""; label: string }[] =
                              [
                                { id: "", label: "All" },
                                ...banks.map((b) => ({
                                  id: b.id,
                                  label: `[${b.bank_code}] ${b.account_name} - ${b.account_no}${
                                    !b.is_active ? " (OFF)" : ""
                                  }`,
                                })),
                              ];

                            const filtered = kw
                              ? allItems.filter(
                                  (it) =>
                                    it.id !== "" && // kalau sedang search, jangan tampilkan All
                                    it.label.toLowerCase().includes(kw),
                                )
                              : allItems;

                            if (e.key === "ArrowDown" && filtered.length > 0) {
                              e.preventDefault();
                              setFBankIndex((i) =>
                                Math.min(i + 1, filtered.length - 1),
                              );
                              return;
                            }

                            if (e.key === "ArrowUp" && filtered.length > 0) {
                              e.preventDefault();
                              setFBankIndex((i) =>
                                Math.max(i - 1, 0),
                              );
                              return;
                            }

                            if (e.key === "Enter" && filtered.length > 0) {
                              e.preventDefault();
                              const pick =
                                filtered[
                                  Math.min(
                                    fBankIndex,
                                    filtered.length - 1,
                                  )
                                ];
                              if (pick) {
                                setFBankId(
                                  pick.id === "" ? "" : Number(pick.id),
                                );
                              }
                              setFBankOpen(false);
                              return;
                            }

                            if (e.key === "Escape") {
                              e.preventDefault();
                              setFBankOpen(false);
                            }
                          }}
                        />
                      </div>

                      {/* List bank */}
                      <div className="max-h-64 overflow-auto">
                        {(() => {
                          const kw = fBankSearch.trim().toLowerCase();
                          const allItems: { id: number | ""; label: string }[] =
                            [
                              { id: "", label: "All" },
                              ...banks.map((b) => ({
                                id: b.id,
                                label: `[${b.bank_code}] ${b.account_name} - ${b.account_no}${
                                  !b.is_active ? " (OFF)" : ""
                                }`,
                              })),
                            ];

                          const filtered = kw
                            ? allItems.filter(
                                (it) =>
                                  it.id !== "" && // sembunyikan All saat search aktif
                                  it.label.toLowerCase().includes(kw),
                              )
                            : allItems;

                          if (filtered.length === 0) {
                            return (
                              <div className="px-3 py-2 text-sm text-gray-500">
                                Tidak ada bank cocok
                              </div>
                            );
                          }

                          return filtered.map((item, idx) => (
                            <button
                              key={`${item.id || "all"}`}
                              type="button"
                              onClick={() => {
                                setFBankId(
                                  item.id === "" ? "" : Number(item.id),
                                );
                                setFBankOpen(false);
                              }}
                              onMouseEnter={() => setFBankIndex(idx)}
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                                idx === fBankIndex ? "bg-blue-50" : ""
                              }`}
                            >
                              {item.label}
                            </button>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                </div>
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
              {/* Submit */}
              <th className="w-28">
                <button
                  onClick={() => load(1)}
                  className="rounded bg-blue-600 text-white px-3 py-1"
                >
                  submit
                </button>
              </th>
              <th className="w-26" />
              <th className="w-26" />
              <th className="w-20" />
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
              <tr>
                <td colSpan={10}>Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10}>No data</td>
              </tr>
            ) : (
              rows.map((r) => {
                const creator =
                  (r.created_by && creatorMap[r.created_by]) ||
                  r.created_by ||
                  "-";
                const revTag = reversalTag(r);
                const pdpTagStr = pdpTag(r);
                const tag = revTag ?? pdpTagStr;
                const descDisplay = displayDescForRow(r, pdpTagStr);

                return (
                  <tr key={r.id} className="align-top">
                    <td>{r.id}</td>
                    <td>{formatIdDateTime(r.performed_at)}</td>
                    <td>{formatIdDateTime(r.txn_at)}</td>
                    <td>{catLabelForRow(r)}</td>
                    <td className="whitespace-normal break-words">
                      <div className="font-semibold">
                        {bankLabel(r.bank_id)}{" "}
                        <span className="text-gray-500">{tag}</span>
                      </div>
                      <div className="my-1 h-px bg-gray-200" />
                      <div className="text-sm text-gray-700">
                        {extraInfo(r)}
                      </div>
                    </td>
                    <td className="whitespace-normal break-words">
                      {descDisplay}
                    </td>
                    <td className="text-right align-top">
                      {/* Amount NET (yang sekarang) */}
                      <div>{formatAmount(r.amount)}</div>

                      {/* Detail khusus Deposit */}
                      {(r.kind === "DEPOSIT" || r.kind === "REVERSAL_DEPOSIT") &&
                        r.deposit_id &&
                        depositMap[r.deposit_id] && (
                          <>
                            <div className="my-1 h-px bg-gray-200" />
                            <div className="text-[11px] leading-4 text-emerald-700/60 dark:text-emerald-200/70">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-left">Gross:</span>
                                <span className="text-right tabular-nums whitespace-nowrap">
                                  {formatAmount(depositMap[r.deposit_id].amount_gross)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-left">Fee:</span>
                                <span className="text-right tabular-nums whitespace-nowrap">
                                  {formatAmount(depositMap[r.deposit_id].fee_amount)}
                                </span>
                              </div>
                            </div>
                          </>
                        )}
                    </td>
                    <td className="text-right">
                      {formatAmount(r.balance_before)}
                    </td>
                    <td className="text-right">
                      {formatAmount(r.balance_after)}
                    </td>
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
          <button
            onClick={() => page > 1 && load(1)}
            disabled={page <= 1}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            First
          </button>
          <button
            onClick={() => page > 1 && load(page - 1)}
            disabled={page <= 1}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 rounded border bg-white">
            Page {page} / {totalPagesTxt}
          </span>
          <button
            onClick={() => page < totalPages && load(page + 1)}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={() => page < totalPages && load(totalPages)}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Last
          </button>
        </nav>
      </div>
    </div>
  );
}
