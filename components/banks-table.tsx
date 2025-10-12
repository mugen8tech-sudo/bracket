"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

// ----- Role helpers (samakan dengan Sidebar) -----
type AppRole = "admin" | "cs" | "viewer";
type AnyRole = AppRole | "other";

type BankRow = {
  id: number;
  
  tenant_id: string;
  bank_code: string;
  account_name: string;
  account_no: string;
  usage_type: "deposit" | "withdraw" | "neutral";
  is_active: boolean;
  is_pulsa: boolean;
  direct_fee_enabled: boolean;
  direct_fee_percent: number;
  balance: number;
  metadata?: Record<string, any> | null;
};

type LeadLite = {
  id: number;
  username: string | null;
  name: string | null;
  bank: string | null;
  bank_name: string | null;
  bank_no: string | null;
};

const BANK_CODES = [
  "BCA","BRI","BNI","MANDIRI","BSI","CIMB","PERMATA",
  "SEABANK","JAGO","DANA","OVO","GOPAY","SHOPEEPAY",
  "LINKAJA","SAKUKU","OTHER"
];

const EXPENSE_CATEGORY_CODES = [
  "AIR", "BELI REKENING", "BONUS CRM", "BONUS CS", "BONUS MEMBER",
  "BONUS PLAYER", "BONUS SPV", "BONUS TELE", "DATABASE", "DOMAIN & HOSTING",
  "ENTERTAINMENT", "GAJI CS", "GAJI CS WA BLAST", "GAJI DESIGN", "GAJI FINANCE",
  "GAJI HEAD CS", "GAJI HEAD WA BLAST", "GAJI OB", "GAJI PAID ADS", "GAJI SEO",
  "GAJI SPV", "GAJI SPV CRM", "GAJI TELE", "IKLAN", "INTERNET", "INTERNET SEHAT (NAWALA)",
  "IP FEE", "KEAMANAN", "KEBERSIHAN", "KESEHATAN", "KOORDINASI", "LAIN-LAIN", "LAUNDRY",
  "LISTRIK", "LIVECHAT", "MAINTENANCE", "MAKAN", "PANTRY", "PAYPAL", "PERALATAN", "PERLENGKAPAN",
  "PULSA", "RENOVASI FURNITURE & ELECTRONIC", "RENOVASI SIPIL", "SEO", "SETUP FEE (APK)",
  "SEWA", "SKYPE", "SMS BLAST", "THR", "TICKET & TRANSPORTASI", "MAINTENANCE FEE", "OTHER EXPENSE", "MISTAKE CS"
];

/* ---------- Helpers amount (live grouping) ---------- */
function formatWithGroupingLive(raw: string) {
  let cleaned = raw.replace(/,/g, "").replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    cleaned =
      cleaned.slice(0, firstDot + 1) +
      cleaned.slice(firstDot + 1).replace(/\./g, "");
  }
  let [intPart = "0", fracPartRaw] = cleaned.split(".");
  intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart === "") intPart = "0";
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (fracPartRaw !== undefined) {
    const frac = fracPartRaw.slice(0, 2);
    return fracPartRaw.length === 0 ? intGrouped + "." : intGrouped + "." + frac;
  }
  return intGrouped;
}
function toNumber(input: string) {
  let c = (input || "0").replace(/,/g, "");
  if (c.endsWith(".")) c = c.slice(0, -1);
  const n = Number(c);
  return isNaN(n) ? 0 : n;
}
function nowLocalDatetimeValue() {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// === Helpers (signed) untuk Adjustment ===
// Normalisasi semua variasi tanda minus ke '-' (ASCII)
function normalizeMinus(raw: string) {
  return raw.replace(/\u2212|\u2013|\u2014/g, "-"); // minus(−), en/em–dash → '-'
}
// Menerima minus di depan ATAU di belakang (contoh "100000-")
function formatWithGroupingLiveSigned(raw: string) {
  let s = normalizeMinus(raw.trim());
  const isNeg = s.startsWith("-") || s.endsWith("-");
  s = s.replace(/-/g, "");                    // buang semua '-' sebelum grouping
  const grouped = formatWithGroupingLive(s);  // helper existing
  return (isNeg ? "-" : "") + grouped;
}
function toNumberSigned(input: string) {
  let s = normalizeMinus(input.trim());
  const isNeg = s.startsWith("-") || s.endsWith("-");
  s = s.replace(/-/g, "");                    // parsing sebagai absolut
  const n = toNumber(s);                      // helper existing
  return isNeg ? -n : n;
}

// === Helpers untuk Biaya (selalu negatif) ===
function formatWithGroupingLiveNegative(raw: string) {
  // pakai formatter existing -> tambahkan '-' bila ada nilai > 0
  const grouped = formatWithGroupingLive(raw);
  // biarkan 0 atau kosong tanpa tanda minus saat mengetik
  if (!grouped || grouped === "0" || grouped === "0." || /^0(\.0{0,2})?$/.test(grouped)) {
    return grouped;
  }
  return grouped.startsWith("-") ? grouped : "-" + grouped;
}
function toNegativeNumber(input: string) {
  const n = toNumber(input); // baca absolutnya
  if (n === 0) return 0;
  return -Math.abs(n);
}

function normalizeRole(r?: string | null): AnyRole {
  const v = (r || "").toLowerCase();
  if (v === "admin") return "admin";
  if (v === "cs" || v === "assops") return "cs";
  if (v === "viewer" || v === "agent") return "viewer";
  return "other";
}

export default function BanksTable() {
  const supabase = supabaseBrowser();

  const [role, setRole] = useState<AnyRole>("other");
  const [roleLoading, setRoleLoading] = useState(true);

  const [rows, setRows] = useState<BankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantName, setTenantName] = useState<string>("");
  const [tenantCredit, setTenantCredit] = useState<number>(0);

  // ====== setting potongan langsung -> dampak credit tenant ======
  const [showSetting, setShowSetting] = useState(false);
  const [hitCredit, setHitCredit] = useState<boolean>(true);

  // ====== NEW BANK modal ======
  const [showNew, setShowNew] = useState(false);
  const [nbBankCode, setNbBankCode] = useState<string>("");
  const [nbAccName, setNbAccName] = useState<string>("");
  const [nbAccNo, setNbAccNo] = useState<string>("");
  const [nbIsPulsa, setNbIsPulsa] = useState<boolean>(false);
  const [nbDirectFeeEnabled, setNbDirectFeeEnabled] = useState<boolean>(false);
  const [nbDirectFeePct, setNbDirectFeePct] = useState<string>("0.00");

  // ====== DP modal ======
  const [showDP, setShowDP] = useState(false);
  const [dpBank, setDpBank] = useState<BankRow | null>(null);
  const [dpOpenedISO, setDpOpenedISO] = useState<string>("");
  const [dpTxnFinal, setDpTxnFinal] = useState<string>(nowLocalDatetimeValue());
  const [dpAmountStr, setDpAmountStr] = useState<string>("0.00");
  const [dpDesc, setDpDesc] = useState<string>("");

  // ====== WD modal ======
  const [showWD, setShowWD] = useState(false);
  const [wdBank, setWdBank] = useState<BankRow | null>(null);
  const [wdOpenedISO, setWdOpenedISO] = useState<string>("");
  const [wdTxnFinal, setWdTxnFinal] = useState<string>(nowLocalDatetimeValue());
  const [wdAmountStr, setWdAmountStr] = useState<string>("0.00");
  const [wdFeeStr, setWdFeeStr] = useState<string>("0.00");
  const [wdDesc, setWdDesc] = useState<string>("");

  // ====== PDP modal ======
  const [showPDP, setShowPDP] = useState(false);
  const [pdpBank, setPdpBank] = useState<BankRow | null>(null);
  const [pdpOpenedISO, setPdpOpenedISO] = useState<string>("");
  const [pdpTxnFinal, setPdpTxnFinal] = useState<string>(nowLocalDatetimeValue());
  const [pdpAmountStr, setPdpAmountStr] = useState<string>("0.00");
  const [pdpDesc, setPdpDesc] = useState<string>("");

  // ====== TT modal ======
  const [showTT, setShowTT] = useState(false);
  const [ttBankFrom, setTtBankFrom] = useState<BankRow | null>(null);
  const [ttAmountStr, setTtAmountStr] = useState<string>("0.00");
  const [ttFeeStr, setTtFeeStr] = useState<string>("0.00");
  const [ttFromAt, setTtFromAt] = useState<string>(nowLocalDatetimeValue());
  const [ttBankToId, setTtBankToId] = useState<number | "">("");
  const [ttToAt, setTtToAt] = useState<string>(nowLocalDatetimeValue());
  const [ttDesc, setTtDesc] = useState<string>("");

  // ====== ADJ modal ======
  const [showAdj, setShowAdj] = useState(false);
  const [adjBank, setAdjBank] = useState<BankRow | null>(null);
  const [adjAmountStr, setAdjAmountStr] = useState<string>("0.00");
  const [adjOpenedISO, setAdjOpenedISO] = useState<string>("");
  const [adjTxnFinal, setAdjTxnFinal] = useState<string>(nowLocalDatetimeValue());
  const [adjDesc, setAdjDesc] = useState<string>("");

  // ====== BIAYA modal ======
  const [showExpense, setShowExpense] = useState(false);
  const [expenseBank, setExpenseBank] = useState<BankRow | null>(null);
  const [expenseOpenedISO, setExpenseOpenedISO] = useState<string>("");
  const [expenseTxnFinal, setExpenseTxnFinal] = useState<string>(nowLocalDatetimeValue());
  const [expenseAmountStr, setExpenseAmountStr] = useState<string>("0.00");
  const [expenseCategory, setExpenseCategory] = useState<string>(EXPENSE_CATEGORY_CODES[0] ?? "");
  const [expenseDesc, setExpenseDesc] = useState<string>("");

  // player search states (dipakai DP & WD)
  const [leadQuery, setLeadQuery] = useState<string>("");
  const [leadOptions, setLeadOptions] = useState<LeadLite[]>([]);
  const [leadPicked, setLeadPicked] = useState<LeadLite | null>(null);
  const [leadIndex, setLeadIndex] = useState<number>(0);
  const playerInputRef = useRef<HTMLInputElement | null>(null);

  const dpAmountRef = useRef<HTMLInputElement | null>(null);
  const wdAmountRef = useRef<HTMLInputElement | null>(null);
  const wdFeeRef = useRef<HTMLInputElement | null>(null);
  const pdpAmountRef = useRef<HTMLInputElement | null>(null);
  const ttAmountRef = useRef<HTMLInputElement | null>(null);
  const ttFeeRef = useRef<HTMLInputElement | null>(null);
  const adjAmountRef = useRef<HTMLInputElement | null>(null);
  const expenseAmountRef = useRef<HTMLInputElement | null>(null);

  const closeNew = useCallback(() => setShowNew(false), []);
  const openNew  = useCallback(() => setShowNew(true), []);

  const closeDP = useCallback(() => setShowDP(false), []);
  const openDPFor = (b: BankRow) => {
    setDpBank(b);
    setShowDP(true);
    setDpOpenedISO(new Date().toISOString());
    setDpTxnFinal(nowLocalDatetimeValue());
    setDpAmountStr("0.00");
    setDpDesc("");
    setLeadQuery("");
    setLeadOptions([]);
    setLeadPicked(null);
    setLeadIndex(0);
  };

  const closeWD = useCallback(() => setShowWD(false), []);
  const openWDFor = (b: BankRow) => {
    setWdBank(b);
    setShowWD(true);
    setWdOpenedISO(new Date().toISOString());
    setWdTxnFinal(nowLocalDatetimeValue());
    setWdAmountStr("0.00");
    setWdFeeStr("0.00");
    setWdDesc("");
    setLeadQuery("");
    setLeadOptions([]);
    setLeadPicked(null);
    setLeadIndex(0);
  };

  const closePDP = useCallback(() => setShowPDP(false), []);
  const openPDPFor = (b: BankRow) => {
    setPdpBank(b);
    setShowPDP(true);
    setPdpOpenedISO(new Date().toISOString());
    setPdpTxnFinal(nowLocalDatetimeValue());
    setPdpAmountStr("0.00");
    setPdpDesc("");
  };

  const closeTT = useCallback(() => setShowTT(false), []);
  const openTTFor = (b: BankRow) => {
    setTtBankFrom(b);
    setShowTT(true);
    setTtAmountStr("0.00");
    setTtFeeStr("0.00");
    setTtFromAt(nowLocalDatetimeValue());
    setTtToAt(nowLocalDatetimeValue());
    setTtBankToId("");
    setTtDesc("");
  };

  const closeAdj = useCallback(() => setShowAdj(false), []);
  const openAdjFor = (b: BankRow) => {
    setAdjBank(b);
    setShowAdj(true);
    setAdjAmountStr("0.00");
    setAdjOpenedISO(new Date().toISOString());
    setAdjTxnFinal(nowLocalDatetimeValue());
    setAdjDesc("");
    setTimeout(()=>adjAmountRef.current?.select(), 0);
  };

  const closeExpense = useCallback(() => setShowExpense(false), []);
  const openExpenseFor = (b: BankRow) => {
    setExpenseBank(b);
    setShowExpense(true);
    setExpenseOpenedISO(new Date().toISOString());
    setExpenseTxnFinal(nowLocalDatetimeValue());
    setExpenseAmountStr("0.00");
    setExpenseCategory(EXPENSE_CATEGORY_CODES[0] ?? "");
    setExpenseDesc("");
    setTimeout(()=>expenseAmountRef.current?.select(), 0);
  };

  // ESC close (DP/WD/PDP/TT/Setting)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showNew) closeNew();
        if (showDP) closeDP();
        if (showWD) closeWD();
        if (showPDP) closePDP();
        if (showTT) closeTT();
        if (showAdj) closeAdj();
        if (showExpense) closeExpense();
        if (showSetting) setShowSetting(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showNew, showDP, showWD, showPDP, showTT, showAdj, showSetting, closeNew, closeDP, closeWD, closePDP, closeTT, closeAdj]);

  // Listener event (kompatibel dengan tombol existing yang dispatch "open-bank-new")
  useEffect(() => {
    const open = () => setShowNew(true);
    document.addEventListener("open-bank-new", open as EventListener);
    return () => document.removeEventListener("open-bank-new", open as EventListener);
  }, []);

  useEffect(() => {
    (async () => {
      setRoleLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("role")
          .eq("user_id", user.id)
          .single();
        setRole(normalizeRole(prof?.role));
      }
      setRoleLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", user?.id)
      .single();

    if (prof?.tenant_id) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name, credit_balance")
        .eq("id", prof.tenant_id)
        .single();
      setTenantName(tenant?.name ?? "");
      setTenantCredit(tenant?.credit_balance ?? 0);

      const { data: setting } = await supabase
        .from("tenant_settings")
        .select("bank_direct_fee_hits_credit")
        .eq("tenant_id", prof.tenant_id)
        .maybeSingle();
      setHitCredit(setting?.bank_direct_fee_hits_credit ?? true);
    }

    const { data, error } = await supabase
      .from("banks")
      .select("*")
      .eq("is_active", true); // hanya bank aktif

    setLoading(false);
    if (error) alert(error.message);
    else setRows((data as BankRow[]) ?? []);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cari lead by username (untuk DP & WD), exact tanpa wildcard
  useEffect(() => {
    let active = true;
    (async () => {
      const searching = showDP || showWD;
      if (!searching) return;
      const q = leadQuery.trim();
      if (!q) {
        setLeadOptions([]);
        return;
      }
      const { data, error } = await supabase
        .from("leads")
        .select("id, username, name, bank, bank_name, bank_no")
        .ilike("username", q.trim()) // tanpa wildcard, dari checkpoint terbaru
        .limit(10);
      if (!active) return;
      if (error) {
        console.error(error);
        return;
      }
      setLeadOptions((data as LeadLite[]) ?? []);
      setLeadIndex(0);
    })();
    return () => {
      active = false;
    };
  }, [leadQuery, showDP, showWD, supabase]);

  /* ========== Submit NEW BANK ========== */
  const submitNewBank = async () => {
    const bankCode = nbBankCode.trim();
    const accName  = nbAccName.trim();
    const accNo    = nbAccNo.trim();

    if (!bankCode) { alert("Bank Provider wajib dipilih"); return; }
    if (!accName)  { alert("Account Name wajib diisi"); return; }
    if (!accNo)    { alert("Account No wajib diisi"); return; }

    let pct = 0;
    if (nbDirectFeeEnabled) {
      const p = Number(nbDirectFeePct);
      if (Number.isNaN(p)) { alert("Persentase potongan harus angka"); return; }
      if (p < 0 || p > 100) { alert("Persentase potongan 0–100%"); return; }
      pct = Math.round(p * 100) / 100;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { data: prof, error: eProf } = await supabase
      .from("profiles").select("tenant_id").eq("user_id", user?.id).single();
    if (eProf || !prof?.tenant_id) { alert(eProf?.message ?? "Tenant tidak ditemukan"); return; }

    const { error } = await supabase
      .from("banks")
      .insert({
        tenant_id: prof.tenant_id,
        bank_code: bankCode,
        account_name: accName,
        account_no: accNo,
        usage_type: "neutral",
        is_active: true,
        is_pulsa: nbIsPulsa,
        direct_fee_enabled: nbDirectFeeEnabled,
        direct_fee_percent: pct,
        balance: 0
      })
      .select()
      .single();

    if (error) { alert(error.message); return; }

    // reset & refresh
    setShowNew(false);
    setNbBankCode(""); setNbAccName(""); setNbAccNo("");
    setNbIsPulsa(false); setNbDirectFeeEnabled(false); setNbDirectFeePct("0.00");
    await load();
  };

  /* ========== Submit DP ========== */
  const submitDP = async () => {
    if (!dpBank) return;
    if (!leadPicked || !leadPicked.username) {
      alert("Pilih Player (username) lebih dulu.");
      playerInputRef.current?.focus();
      return;
    }
    const gross = toNumber(dpAmountStr);
    if (!(gross > 0)) {
      alert("Amount harus lebih dari 0.");
      dpAmountRef.current?.focus();
      return;
    }
    const txnFinalISO = new Date(dpTxnFinal).toISOString();
    const { error } = await supabase.rpc("perform_deposit", {
      p_bank_id: dpBank.id,
      p_lead_id: leadPicked.id,
      p_username: leadPicked.username,
      p_amount_gross: gross,
      p_txn_at_opened: dpOpenedISO,
      p_txn_at_final: txnFinalISO,
      p_promo_code: null,
      p_description: dpDesc || null,
    });
    if (error) {
      alert(error.message);
      return;
    }
    closeDP();
    await load();
  };

  /* ========== Submit WD ========== */
  const submitWD = async () => {
    if (!wdBank) return;
    if (!leadPicked || !leadPicked.username) {
      alert("Pilih Player (username) lebih dulu.");
      playerInputRef.current?.focus();
      return;
    }
    const gross = toNumber(wdAmountStr);
    if (!(gross > 0)) {
      alert("Amount harus lebih dari 0.");
      wdAmountRef.current?.focus();
      return;
    }
    const fee = toNumber(wdFeeStr);
    const txnFinalISO = new Date(wdTxnFinal).toISOString();

    const { error } = await supabase.rpc("perform_withdrawal", {
      p_bank_id: wdBank.id,
      p_lead_id: leadPicked.id,
      p_username: leadPicked.username,
      p_amount_gross: gross,
      p_transfer_fee_amount: fee,
      p_txn_at_opened: wdOpenedISO,
      p_txn_at_final: txnFinalISO,
      p_description: wdDesc || null,
    });
    if (error) {
      alert(error.message);
      return;
    }
    closeWD();
    await load();
  };

  /* ========== Submit PDP ========== */
  const submitPDP = async () => {
    if (!pdpBank) return;
    const gross = toNumber(pdpAmountStr);
    if (!(gross > 0)) {
      alert("Amount harus > 0");
      pdpAmountRef.current?.focus();
      return;
    }
    const txnFinalISO = new Date(pdpTxnFinal).toISOString();
    const { error } = await supabase.rpc("create_pending_deposit", {
      p_bank_id: pdpBank.id,
      p_amount_gross: gross,
      p_txn_at_opened: pdpOpenedISO,
      p_txn_at_final: txnFinalISO,
      p_description: pdpDesc || null,
    });
    if (error) {
      alert(error.message);
      return;
    }
    closePDP();
    await load();
  };

  /* ========== Submit TT ========== */
  const submitTT = async () => {
    if (!ttBankFrom) return;
    const amt = toNumber(ttAmountStr);
    if (!(amt > 0)) {
      alert("Jumlah transfer harus > 0");
      ttAmountRef.current?.focus();
      return;
    }
    const fee = toNumber(ttFeeStr);
    if (!ttBankToId) {
      alert("Pilih Bank Tujuan");
      return;
    }
    const fromIso = new Date(ttFromAt).toISOString();
    const toIso = new Date(ttToAt).toISOString();

    const { error } = await supabase.rpc("perform_interbank_transfer", {
      p_bank_from_id: ttBankFrom.id,
      p_bank_to_id: Number(ttBankToId),
      p_amount_gross: amt,
      p_transfer_fee_amount: fee,
      p_from_txn_at: fromIso,
      p_to_txn_at: toIso,
      p_description: ttDesc || null,
    });
    if (error) {
      alert(error.message);
      return;
    }
    closeTT();
    await load();
  };

  /* ========== Submit ADJ ========== */
  const submitAdj = async () => {
    if (!adjBank) return;
    const delta = toNumberSigned(adjAmountStr); // <— PENTING: signed
    if (delta === 0) { alert("Amount tidak boleh 0."); adjAmountRef.current?.focus(); return; }

    const { error } = await supabase.rpc("perform_bank_adjustment", {
      p_bank_id: adjBank.id,
      p_amount_delta: delta, // boleh negatif/positif
      p_txn_at_opened: adjOpenedISO,
      p_txn_at_final: new Date(adjTxnFinal).toISOString(),
      p_description: adjDesc || null,
    });

    if (error) { alert(error.message); return; }
    closeAdj();
    await load();
  };

  /* ========== Submit BIAYA ========== */
  const submitExpense = async () => {
    if (!expenseBank) return;
    const amt = toNegativeNumber(expenseAmountStr); // negatif otomatis
    if (amt === 0) {
      alert("Amount harus lebih dari 0.");
      expenseAmountRef.current?.focus();
      return;
    }
    const { error } = await supabase.rpc("perform_bank_expense", {
      p_bank_id: expenseBank.id,
      p_amount: amt, // sudah negatif
      p_txn_at_opened: expenseOpenedISO,
      p_txn_at_final: new Date(expenseTxnFinal).toISOString(),
      p_category_code: expenseCategory || null,
      p_description: expenseDesc || null,
    });
    if (error) { alert(error.message); return; }
    closeExpense();
    await load();
  };

  const saveSetting = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Silakan login ulang.");
      return;
    }

    // ⬇️ ambil role juga
    const { data: prof, error: e1 } = await supabase
      .from("profiles")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .single();

    if (e1) {
      alert(e1.message);
      return;
    }

    // ⬇️ guard: hanya admin yang boleh submit
    const role = (prof?.role ?? "").toLowerCase();
    if (role !== "admin") {
      alert("Hanya admin yang bisa menyimpan Setting Potongan.");
      return;
    }

    // lanjutkan proses simpan seperti biasa
    const { error } = await supabase.from("tenant_settings").upsert({
      tenant_id: prof?.tenant_id,
      bank_direct_fee_hits_credit: hitCredit,
      updated_at: new Date().toISOString(),
      updated_by: user.id ?? null,
    });

    if (error) {
      alert(error.message);
      return;
    }

    setShowSetting(false);
  };

  const DisabledBtn = ({
    label,
    title,
  }: {
    label: string;
    title: string;
  }) => (
    <button
      className="h-8 min-w-[52px] px-3 rounded bg-blue-600 text-white opacity-70 cursor-not-allowed"
      title={title}
      disabled
    >
      {label}
    </button>
  );

  // list bank tujuan aktif (selain bank asal)
  const bankToOptions = (from?: BankRow) =>
    rows.filter(
      (b) => b.is_active && (!from || b.id !== from.id)
    );

  /* ================== RENDER ================== */
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            // guard terakhir di client
            if (role !== "admin") {
              alert("Hanya admin yang bisa membuka Setting Potongan.");
              return;
            }
            setShowSetting(true);
          }}
          disabled={roleLoading || role !== "admin"}
          aria-disabled={roleLoading || role !== "admin"}
          className={`rounded bg-gray-100 px-4 py-2 ${
            roleLoading || role !== "admin" ? "opacity-50 cursor-not-allowed" : ""
          }`}
          title={
            roleLoading
              ? "Memuat role…"
              : role !== "admin"
              ? "Hanya admin yang bisa submit"
              : "Pengaturan dampak potongan langsung ke credit tenant"
          }
        >
          Setting Potongan → Credit
        </button>
        <button
          type="button"
          onClick={() => {
            const evt = new CustomEvent("open-bank-new");
            document.dispatchEvent(evt);
          }}
          className="rounded bg-green-600 text-white px-4 py-2"
        >
          New Record
        </button>
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table
          className="table-grid banks-grid min-w-[1000px]"
          style={{ borderCollapse: "collapse" }}
        >
          <thead>
            {/* Baris ringkasan balance di atas header kolom */}
            <tr>
              <th colSpan={6} className="text-left p-1">
                Balance: {formatAmount(tenantCredit)}
              </th>
            </tr>

            {/* Header kolom existing */}
            <tr>
              <th className="text-left w-16">ID</th>
              <th className="text-left min-w-[260px]">Bank</th>
              <th className="text-center w-44">Website</th>
              <th className="text-center w-48">Balance</th>
              <th className="text-center w-64">Player Action</th>
              <th className="text-center w-64">CS Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6}>Loading…</td>
              </tr>
            ) : (() => {
                // filter hanya ACTIVE, lalu urutkan berdasarkan metadata.display_order
                const getOrder = (x: any) => {
                  const v = x?.metadata?.display_order;
                  const n = Number(v);
                  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
                };

                const data = [...rows]
                  .filter((b) => b.is_active)                    // sembunyikan DELETED
                  .sort((a, b) => {
                    const ao = getOrder(a);
                    const bo = getOrder(b);
                    if (ao !== bo) return ao - bo;               // urut ASC
                    return b.id - a.id;                          // fallback: ID terbaru dulu
                  });

                if (data.length === 0) {
                  return (
                    <tr>
                      <td colSpan={6}>No data</td>
                    </tr>
                  );
                }

                return data.map((r) => {
                  const rowBg =
                    r.usage_type === "deposit"
                      ? "bg-green-200"
                      : r.usage_type === "withdraw"
                      ? "bg-red-200"
                      : "bg-white";

                  return (
                    <tr key={r.id} className={rowBg}>
                      <td>{r.id}</td>
                      <td className="whitespace-normal break-words">
                        <div className="font-semibold">
                          [{r.bank_code}] {r.account_name}
                        </div>
                        <div className="text-xs">{r.account_no}</div>
                      </td>
                      <td className="text-center">{tenantName || "-"}</td>
                      <td className="text-center">{formatAmount(r.balance)}</td>
                      <td className="text-center">
                        <div className="inline-flex items-center gap-2">
                          <button
                            className="h-8 min-w-[52px] px-3 rounded bg-blue-600 text-white"
                            title="Deposit"
                            onClick={() => openDPFor(r)}
                          >
                            DP
                          </button>
                          <button
                            className="h-8 min-w-[52px] px-3 rounded bg-blue-600 text-white"
                            title="Withdraw"
                            onClick={() => openWDFor(r)}
                          >
                            WD
                          </button>
                          <button
                            className="h-8 min-w-[52px] px-3 rounded bg-blue-600 text-white"
                            title="Pending Deposit"
                            onClick={() => openPDPFor(r)}
                          >
                            PDP
                          </button>
                        </div>
                      </td>
                      <td className="text-center">
                        <div className="inline-flex items-center gap-2">
                          <button
                            className="h-8 min-w-[52px] px-3 rounded bg-blue-600 text-white"
                            title="Interbank Transfer"
                            onClick={() => openTTFor(r)}
                          >
                            TT
                          </button>
                          <button
                            className="h-8 min-w-[52px] px-3 rounded bg-blue-600 text-white"
                            title="Bank Adjustment"
                            onClick={() => openAdjFor(r)}
                          >
                            Adj
                          </button>
                          <button
                            className="h-8 min-w-[52px] px-3 rounded bg-blue-600 text-white"
                            title="Biaya"
                            onClick={() => openExpenseFor(r)}
                          >
                            Biaya
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                });
              })()}
          </tbody>
        </table>
      </div>

      {/* ===== Modal New Bank ===== */}
      {showNew && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => { if (e.currentTarget === e.target) closeNew(); }}
        >
          <form
            onSubmit={(e) => { e.preventDefault(); submitNewBank(); }}
            className="bg-white rounded border w-full max-w-xl mt-10"
          >
            <div className="p-4 border-b font-semibold">New Bank</div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Bank Provider</label>
                <select
                  className="border rounded px-3 py-2 w-full"
                  value={nbBankCode}
                  onChange={(e)=>setNbBankCode(e.target.value)}
                  required
                >
                  <option value="">Pilih bank</option>
                  {BANK_CODES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs mb-1">Account Name</label>
                  <input
                    className="border rounded px-3 py-2 w-full"
                    value={nbAccName}
                    onChange={(e)=>setNbAccName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1">Account No</label>
                  <input
                    className="border rounded px-3 py-2 w-full"
                    value={nbAccNo}
                    onChange={(e)=>setNbAccNo(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input id="nb_pulsa" type="checkbox" checked={nbIsPulsa} onChange={(e)=>setNbIsPulsa(e.target.checked)} />
                <label htmlFor="nb_pulsa">Is Pulsa?</label>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input id="nb_df" type="checkbox" checked={nbDirectFeeEnabled} onChange={(e)=>setNbDirectFeeEnabled(e.target.checked)} />
                  <label htmlFor="nb_df">Potongan Langsung?</label>
                </div>
                {nbDirectFeeEnabled && (
                  <div>
                    <label className="block text-xs mb-1">Persentase Potongan (%)</label>
                    <input
                      type="number" min={0} max={100} step="0.01"
                      className="border rounded px-3 py-2 w-full"
                      value={nbDirectFeePct}
                      onChange={(e)=>setNbDirectFeePct(e.target.value)}
                      required
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={closeNew} className="rounded px-4 py-2 bg-gray-100">Close</button>
              <button type="submit" className="rounded px-4 py-2 bg-blue-600 text-white">Save</button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Modal Setting ===== */}
      {showSetting && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) setShowSetting(false);
          }}
        >
          <div className="bg-white rounded border w-full max-w-md mt-10">
            <div className="p-4 border-b font-semibold">
              Potongan Langsung → Credit Tenant
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div>
                Atur <b>dampak potongan langsung</b> terhadap <b>credit tenant</b>{" "}
                saat <b>Deposit</b>:
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="hitcredit"
                  type="checkbox"
                  checked={hitCredit}
                  onChange={(e) => setHitCredit(e.target.checked)}
                />
                <label htmlFor="hitcredit">
                  <b>ON</b> = credit dikurangi <b>NET</b>. &nbsp;Matikan (OFF) =
                  credit dikurangi <b>GROSS</b>.
                </label>
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button
                onClick={() => setShowSetting(false)}
                className="rounded px-4 py-2 bg-gray-100"
              >
                Close
              </button>
              <button
                onClick={saveSetting}
                className="rounded px-4 py-2 bg-blue-600 text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal DP ===== */}
      {showDP && dpBank && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) closeDP();
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitDP();
            }}
            className="bg-white rounded border w-full max-w-2xl mt-10"
          >
            <div className="p-4 border-b">
              <div className="font-semibold">
                Deposit to [{dpBank.bank_code}] {dpBank.account_name} -{" "}
                {dpBank.account_no}
              </div>
              <div className="text-xs mt-1">
                Balance: <b>{formatAmount(tenantCredit)}</b>
              </div>
            </div>
            <div className="p-4 space-y-3">
              {/* Player */}
              <div>
                <label className="block text-xs mb-1">Player</label>
                <div className="relative">
                  <input
                    ref={playerInputRef}
                    className="border rounded px-3 py-2 w-full"
                    placeholder="search username"
                    value={leadPicked ? (leadPicked.username ?? "") : leadQuery}
                    onChange={(e) => {
                      setLeadPicked(null);
                      setLeadQuery(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (!leadPicked && leadOptions.length > 0) {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setLeadIndex((i) =>
                            Math.min(i + 1, leadOptions.length - 1)
                          );
                          return;
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setLeadIndex((i) => Math.max(i - 1, 0));
                          return;
                        }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const pick = leadOptions[Math.max(0, leadIndex)];
                          if (pick) {
                            setLeadPicked(pick);
                            setLeadOptions([]);
                          }
                          return;
                        }
                      }
                    }}
                  />
                  {!leadPicked && leadOptions.length > 0 && (
                    <div className="absolute z-10 mt-1 max-h-56 overflow-auto w-full border bg-white rounded shadow">
                      {leadOptions.map((opt, idx) => (
                        <div
                          key={opt.id}
                          onClick={() => {
                            setLeadPicked(opt);
                            setLeadOptions([]);
                          }}
                          className={`px-3 py-2 cursor-pointer text-sm hover:bg-gray-100 ${
                            idx === leadIndex ? "bg-blue-50" : ""
                          }`}
                        >
                          {opt.username} ({opt.bank ?? opt.bank_name} |{" "}
                          {opt.name} | {opt.bank_no})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* Amount */}
              <div>
                <label className="block text-xs mb-1">Amount</label>
                <input
                  ref={dpAmountRef}
                  className="border rounded px-3 py-2 w-full"
                  value={dpAmountStr}
                  onFocus={(e)=>e.currentTarget.select()}
                  onChange={(e)=>{
                    const f = formatWithGroupingLiveSigned(e.target.value);
                    setDpAmountStr(f);
                    setTimeout(()=>{ const el=dpAmountRef.current; if(el){ const L=el.value.length; el.setSelectionRange(L,L);} },0);
                  }}
                  onBlur={()=>{
                    const n = toNumberSigned(dpAmountStr);
                    setDpAmountStr(
                      new Intl.NumberFormat("en-US",{ minimumFractionDigits:2, maximumFractionDigits:2 }).format(n)
                    );
                  }}
                />
              </div>
              {/* Tgl */}
              <div>
                <label className="block text-xs mb-1">Transaction Date</label>
                <input
                  type="datetime-local"
                  step="1"
                  className="border rounded px-3 py-2 w-full"
                  value={dpTxnFinal}
                  onChange={(e) => setDpTxnFinal(e.target.value)}
                />
              </div>
              {/* Description */}
              <div>
                <label className="block text-xs mb-1">Description</label>
                <textarea
                  rows={3}
                  className="border rounded px-3 py-2 w-full"
                  value={dpDesc}
                  onChange={(e) => setDpDesc(e.target.value)}
                />
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDP}
                className="rounded px-4 py-2 bg-gray-100"
              >
                Close
              </button>
              <button
                type="submit"
                className="rounded px-4 py-2 bg-blue-600 text-white"
              >
                Submit
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Modal WD ===== */}
      {showWD && wdBank && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) closeWD();
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitWD();
            }}
            className="bg-white rounded border w-full max-w-2xl mt-10"
          >
            <div className="p-4 border-b">
              <div className="font-semibold">
                Withdraw from [{wdBank.bank_code}] {wdBank.account_name} -{" "}
                {wdBank.account_no}
              </div>
              <div className="text-xs mt-1">
                Balance: <b>{formatAmount(tenantCredit)}</b>
              </div>
            </div>
            <div className="p-4 space-y-3">
              {/* Player */}
              <div>
                <label className="block text-xs mb-1">Player</label>
                <div className="relative">
                  <input
                    ref={playerInputRef}
                    className="border rounded px-3 py-2 w-full"
                    placeholder="search username"
                    value={leadPicked ? (leadPicked.username ?? "") : leadQuery}
                    onChange={(e) => {
                      setLeadPicked(null);
                      setLeadQuery(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (!leadPicked && leadOptions.length > 0) {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setLeadIndex((i) =>
                            Math.min(i + 1, leadOptions.length - 1)
                          );
                          return;
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setLeadIndex((i) => Math.max(i - 1, 0));
                          return;
                        }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const pick = leadOptions[Math.max(0, leadIndex)];
                          if (pick) {
                            setLeadPicked(pick);
                            setLeadOptions([]);
                          }
                          return;
                        }
                      }
                    }}
                  />
                  {!leadPicked && leadOptions.length > 0 && (
                    <div className="absolute z-10 mt-1 max-h-56 overflow-auto w-full border bg-white rounded shadow">
                      {leadOptions.map((opt, idx) => (
                        <div
                          key={opt.id}
                          onClick={() => {
                            setLeadPicked(opt);
                            setLeadOptions([]);
                          }}
                          className={`px-3 py-2 cursor-pointer text-sm hover:bg-gray-100 ${
                            idx === leadIndex ? "bg-blue-50" : ""
                          }`}
                        >
                          {opt.username} ({opt.bank ?? opt.bank_name} |{" "}
                          {opt.name} | {opt.bank_no})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* Amount */}
              <div>
                <label className="block text-xs mb-1">Amount (Gross)</label>
                <input
                  ref={wdAmountRef}
                  className="border rounded px-3 py-2 w-full"
                  value={wdAmountStr}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    const f = formatWithGroupingLive(e.target.value);
                    setWdAmountStr(f);
                    setTimeout(() => {
                      const el = wdAmountRef.current;
                      if (el) {
                        const L = el.value.length;
                        el.setSelectionRange(L, L);
                      }
                    }, 0);
                  }}
                  onBlur={() => {
                    const n = toNumber(wdAmountStr);
                    setWdAmountStr(
                      new Intl.NumberFormat("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(n)
                    );
                  }}
                />
              </div>
              {/* Transfer Fee */}
              <div>
                <label className="block text-xs mb-1">Transfer Fee</label>
                <input
                  ref={wdFeeRef}
                  className="border rounded px-3 py-2 w-full"
                  value={wdFeeStr}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    const f = formatWithGroupingLive(e.target.value);
                    setWdFeeStr(f);
                    setTimeout(() => {
                      const el = wdFeeRef.current;
                      if (el) {
                        const L = el.value.length;
                        el.setSelectionRange(L, L);
                      }
                    }, 0);
                  }}
                  onBlur={() => {
                    const n = toNumber(wdFeeStr);
                    setWdFeeStr(
                      new Intl.NumberFormat("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(n)
                    );
                  }}
                />
              </div>
              {/* Tgl */}
              <div>
                <label className="block text-xs mb-1">Transaction Date</label>
                <input
                  type="datetime-local"
                  step="1"
                  className="border rounded px-3 py-2 w-full"
                  value={wdTxnFinal}
                  onChange={(e) => setWdTxnFinal(e.target.value)}
                />
              </div>
              {/* Description */}
              <div>
                <label className="block text-xs mb-1">Description</label>
                <textarea
                  rows={3}
                  className="border rounded px-3 py-2 w-full"
                  value={wdDesc}
                  onChange={(e) => setWdDesc(e.target.value)}
                />
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeWD}
                className="rounded px-4 py-2 bg-gray-100"
              >
                Close
              </button>
              <button
                type="submit"
                className="rounded px-4 py-2 bg-blue-600 text-white"
              >
                Submit
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Modal PDP ===== */}
      {showPDP && pdpBank && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) closePDP();
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitPDP();
            }}
            className="bg-white rounded border w-full max-w-2xl mt-10"
          >
            <div className="p-4 border-b">
              <div className="font-semibold">
                Pending Deposit untuk [{pdpBank.bank_code}] {pdpBank.account_name} -{" "}
                {pdpBank.account_no}
              </div>
              <div className="text-xs mt-1">
                Balance: <b>{formatAmount(tenantCredit)}</b>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Amount (Gross)</label>
                <input
                  ref={pdpAmountRef}
                  className="border rounded px-3 py-2 w-full"
                  value={pdpAmountStr}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    const f = formatWithGroupingLive(e.target.value);
                    setPdpAmountStr(f);
                    setTimeout(() => {
                      const el = pdpAmountRef.current;
                      if (el) {
                        const L = el.value.length;
                        el.setSelectionRange(L, L);
                      }
                    }, 0);
                  }}
                  onBlur={() => {
                    const n = toNumber(pdpAmountStr);
                    setPdpAmountStr(
                      new Intl.NumberFormat("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(n)
                    );
                  }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Transaction Date</label>
                <input
                  type="datetime-local"
                  step="1"
                  className="border rounded px-3 py-2 w-full"
                  value={pdpTxnFinal}
                  onChange={(e) => setPdpTxnFinal(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Description</label>
                <textarea
                  rows={3}
                  className="border rounded px-3 py-2 w-full"
                  value={pdpDesc}
                  onChange={(e) => setPdpDesc(e.target.value)}
                />
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closePDP}
                className="rounded px-4 py-2 bg-gray-100"
              >
                Close
              </button>
              <button
                type="submit"
                className="rounded px-4 py-2 bg-blue-600 text-white"
              >
                Submit
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Modal TT ===== */}
      {showTT && ttBankFrom && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) closeTT();
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitTT();
            }}
            className="bg-white rounded border w-full max-w-2xl mt-10"
          >
            <div className="p-4 border-b">
              <div className="font-semibold">
                Transfer from [{ttBankFrom.bank_code}] {ttBankFrom.account_name} -{" "}
                {ttBankFrom.account_no}
              </div>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Jumlah Transfer</label>
                <input
                  ref={ttAmountRef}
                  className="border rounded px-3 py-2 w-full"
                  value={ttAmountStr}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    const f = formatWithGroupingLive(e.target.value);
                    setTtAmountStr(f);
                    setTimeout(() => {
                      const el = ttAmountRef.current;
                      if (el) {
                        const L = el.value.length;
                        el.setSelectionRange(L, L);
                      }
                    }, 0);
                  }}
                  onBlur={() => {
                    const n = toNumber(ttAmountStr);
                    setTtAmountStr(
                      new Intl.NumberFormat("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(n)
                    );
                  }}
                />
              </div>

              <div>
                <label className="block text-xs mb-1">Biaya Transfer</label>
                <input
                  ref={ttFeeRef}
                  className="border rounded px-3 py-2 w-full"
                  value={ttFeeStr}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    const f = formatWithGroupingLive(e.target.value);
                    setTtFeeStr(f);
                    setTimeout(() => {
                      const el = ttFeeRef.current;
                      if (el) {
                        const L = el.value.length;
                        el.setSelectionRange(L, L);
                      }
                    }, 0);
                  }}
                  onBlur={() => {
                    const n = toNumber(ttFeeStr);
                    setTtFeeStr(
                      new Intl.NumberFormat("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(n)
                    );
                  }}
                />
              </div>

              <div>
                <label className="block text-xs mb-1">
                  Waktu Transaksi Bank Asal
                </label>
                <input
                  type="datetime-local"
                  step="1"
                  className="border rounded px-3 py-2 w-full"
                  value={ttFromAt}
                  onChange={(e) => setTtFromAt(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs mb-1">Bank Tujuan</label>
                <select
                  className="border rounded px-3 py-2 w-full"
                  value={ttBankToId ?? ""}
                  onChange={(e) => setTtBankToId(Number(e.target.value))}
                >
                  <option value="">Pilih bank tujuan</option>
                  {bankToOptions(ttBankFrom).map((b) => (
                    <option key={b.id} value={b.id}>
                      [{b.bank_code}] {b.account_name} - {b.account_no}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs mb-1">
                  Waktu Transaksi Bank Tujuan
                </label>
                <input
                  type="datetime-local"
                  step="1"
                  className="border rounded px-3 py-2 w-full"
                  value={ttToAt}
                  onChange={(e) => setTtToAt(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs mb-1">Description</label>
                <textarea
                  rows={3}
                  className="border rounded px-3 py-2 w-full"
                  value={ttDesc}
                  onChange={(e) => setTtDesc(e.target.value)}
                />
              </div>
            </div>

            <div className="border-t p-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeTT}
                className="rounded px-4 py-2 bg-gray-100"
              >
                Close
              </button>
              <button
                type="submit"
                className="rounded px-4 py-2 bg-blue-600 text-white"
              >
                Submit
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Modal ADJ ===== */}
      {showAdj && adjBank && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e)=>{ if(e.currentTarget===e.target) closeAdj(); }}
        >
          <form
            onSubmit={(e)=>{ e.preventDefault(); submitAdj(); }}
            className="bg-white rounded border w-full max-w-2xl mt-10"
          >
            <div className="p-4 border-b">
              <div className="font-semibold">
                Adjustment di [{adjBank.bank_code}] {adjBank.account_name} - {adjBank.account_no}
              </div>
            </div>

            <div className="p-4 space-y-3">
              {/* Amount (+/-) */}
              <div>
                <label className="block text-xs mb-1">Amount</label>
                <input
                  ref={adjAmountRef}
                  className="border rounded px-3 py-2 w-full"
                  value={adjAmountStr}
                  onFocus={(e)=>e.currentTarget.select()}
                  onChange={(e)=>{
                    const f = formatWithGroupingLiveSigned(e.target.value);
                    setAdjAmountStr(f);
                    setTimeout(()=>{ const el=adjAmountRef.current; if(el){ const L=el.value.length; el.setSelectionRange(L,L);} },0);
                  }}
                  onBlur={()=>{
                    const n = toNumberSigned(adjAmountStr);
                    setAdjAmountStr(
                      new Intl.NumberFormat("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 }).format(n)
                    );
                  }}
                />
              </div>

              {/* Tgl */}
              <div>
                <label className="block text-xs mb-1">Transaction Date</label>
                <input
                  type="datetime-local"
                  step="1"
                  className="border rounded px-3 py-2 w-full"
                  value={adjTxnFinal}
                  onChange={(e)=>setAdjTxnFinal(e.target.value)}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs mb-1">Description</label>
                <textarea
                  rows={3}
                  className="border rounded px-3 py-2 w-full"
                  value={adjDesc}
                  onChange={(e)=>setAdjDesc(e.target.value)}
                />
              </div>
            </div>

            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={closeAdj} className="rounded px-4 py-2 bg-gray-100">Close</button>
              <button type="submit" className="rounded px-4 py-2 bg-blue-600 text-white">Submit</button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Modal BIAYA ===== */}
      {showExpense && expenseBank && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e)=>{ if(e.currentTarget===e.target) closeExpense(); }}
        >
          <form
            onSubmit={(e)=>{ e.preventDefault(); submitExpense(); }}
            className="bg-white rounded border w-full max-w-2xl mt-10"
          >
            <div className="p-4 border-b">
              <div className="font-semibold">
                Biaya FROM [{expenseBank.bank_code}] {expenseBank.account_name} - {expenseBank.account_no}
              </div>
            </div>

            <div className="p-4 space-y-3">
              {/* Amount (selalu minus) */}
              <div>
                <label className="block text-xs mb-1">Amount</label>
                <input
                  ref={expenseAmountRef}
                  className="border rounded px-3 py-2 w-full"
                  value={expenseAmountStr}
                  onFocus={(e)=>e.currentTarget.select()}
                  onChange={(e)=>{
                    const f = formatWithGroupingLiveNegative(e.target.value);
                    setExpenseAmountStr(f);
                    setTimeout(()=>{ const el=expenseAmountRef.current; if(el){ const L=el.value.length; el.setSelectionRange(L,L);} },0);
                  }}
                  onBlur={()=>{
                    const n = toNegativeNumber(expenseAmountStr);
                    setExpenseAmountStr(
                      new Intl.NumberFormat("en-US",{ minimumFractionDigits:2, maximumFractionDigits:2 }).format(n)
                    );
                  }}
                />
              </div>

              {/* Tgl */}
              <div>
                <label className="block text-xs mb-1">Transaction Date</label>
                <input
                  type="datetime-local"
                  step="1"
                  className="border rounded px-3 py-2 w-full"
                  value={expenseTxnFinal}
                  onChange={(e)=>setExpenseTxnFinal(e.target.value)}
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs mb-1">Category</label>
                <select
                  className="border rounded px-3 py-2 w-full"
                  value={expenseCategory}
                  onChange={(e)=>setExpenseCategory(e.target.value)}
                >
                  {EXPENSE_CATEGORY_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs mb-1">Description</label>
                <textarea
                  rows={3}
                  className="border rounded px-3 py-2 w-full"
                  value={expenseDesc}
                  onChange={(e)=>setExpenseDesc(e.target.value)}
                />
              </div>
            </div>

            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={closeExpense} className="rounded px-4 py-2 bg-gray-100">Close</button>
              <button type="submit" className="rounded px-4 py-2 bg-blue-600 text-white">Submit</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
