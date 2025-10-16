"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

function useSubmitGuard() {
  const lockRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const run = useCallback(async <T,>(fn: () => Promise<T> | T) => {
    if (lockRef.current) return;        // sudah terkunci → abaikan submit berikutnya
    lockRef.current = true;
    setSubmitting(true);
    try {
      return await fn();
    } finally {
      setSubmitting(false);
      lockRef.current = false;
    }
  }, []);

  return { submitting, run };
}

/** ====== Types & Const ====== */
type UserRow = {
  seq_id: number;
  user_id: string;
  full_name: string;
  email: string;
  role: string;         // admin | cs | viewer | (lainnya)
  is_resigned: boolean;
  created_at: string;
  total_count?: number; // dari window count
};

type MyRole = "admin" | "cs" | "viewer" | "other";
const PAGE_SIZE = 50;

/** ====== Helpers ====== */
function normalizeRole(r?: string | null): MyRole {
  const v = (r ?? "").toLowerCase();
  if (v === "admin") return "admin";
  if (v === "cs") return "cs";
  if (v === "viewer") return "viewer";
  return "other";
}

export default function UserManagement() {
  const supabase = supabaseBrowser();

  // guard + header
  const [authorized, setAuthorized] = useState<"loading"|"ok"|"no">("loading"); // ← admin-only guard
  const [myRole, setMyRole] = useState<MyRole>("other");
  const [tenantName, setTenantName] = useState("");
  const [tenantId, setTenantId] = useState("");

  // submit guards
  const searchGuard = useSubmitGuard();
  const newGuard    = useSubmitGuard();
  const editGuard   = useSubmitGuard();
  const pwdGuard    = useSubmitGuard();
  const resignGuard = useSubmitGuard();

  const isSubmittingAny =
    searchGuard.submitting || newGuard.submitting || editGuard.submitting ||
    pwdGuard.submitting || resignGuard.submitting;

  // list
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ====== Modals ======
  const [showNew, setShowNew] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [showResign, setShowResign] = useState(false);

  // New
  const [nName, setNName] = useState("");
  const [nEmail, setNEmail] = useState("");
  const [nPwd, setNPwd] = useState("");
  const [nPwd2, setNPwd2] = useState("");
  const [nIsAdmin, setNIsAdmin] = useState(false);
  const [nIsCS, setNIsCS] = useState(false);
  const newNameRef = useRef<HTMLInputElement | null>(null);

  // Edit
  const [eUserId, setEUserId] = useState("");
  const [eName, setEName] = useState("");
  const [eEmail, setEEmail] = useState("");
  const [eIsAdmin, setEIsAdmin] = useState(false);
  const [eIsCS, setEIsCS] = useState(false);

  // Change Password
  const [pUserId, setPUserId] = useState("");
  const [pName, setPName] = useState("");
  const [pPwd, setPPwd] = useState("");
  const [pPwd2, setPPwd2] = useState("");

  // Resign
  const [rUserId, setRUserId] = useState("");
  const [rName, setRName] = useState("");
  const [rReason, setRReason] = useState("");

  /** ====== ESC untuk menutup modal (meniru Banks) ====== */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isSubmittingAny) { e.preventDefault(); return; } // ← kunci saat submit
        if (showNew) setShowNew(false);
        if (showEdit) setShowEdit(false);
        if (showPwd) setShowPwd(false);
        if (showResign) setShowResign(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isSubmittingAny, showNew, showEdit, showPwd, showResign]);

  /** ====== Bootstrap: cek role (admin-only) & tenant name ====== */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAuthorized("no"); return; }

      const { data: prof } = await supabase
        .from("profiles")
        .select("tenant_id, role")
        .eq("user_id", user.id)
        .single();

      const role = normalizeRole(prof?.role);
      if (role !== "admin") { setAuthorized("no"); return; }
      setAuthorized("ok");
      setMyRole(role);

      const tid = prof?.tenant_id ?? "";
      setTenantId(tid);

      if (tid) {
        const { data: t } = await supabase
          .from("tenants")
          .select("name")
          .eq("id", tid)
          .single();
        setTenantName(t?.name ?? "");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ====== Load list via RPC (Langkah 1) ====== */
  const load = async (pageToLoad = page) => {
    setLoading(true);
    const offset = (pageToLoad - 1) * PAGE_SIZE;
    const { data, error } = await supabase.rpc("app_list_users_my_tenant", {
      p_search: search.trim() ? search.trim() : null,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    setLoading(false);
    if (error) {
      alert(error.message);
      return;
    }
    const list = (data as UserRow[]) ?? [];
    setRows(list);
    const tc = list.length > 0 ? Number(list[0].total_count || 0) : 0;
    setTotal(tc);
    setPage(pageToLoad);
  };

  // Load list hanya setelah authorized === "ok"
  useEffect(() => {
    if (authorized === "ok") load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized]);

  const applySearch: React.FormEventHandler = (e) => {
    e.preventDefault();
    searchGuard.run(() => load(1));
  };

  const pageLabel = useMemo(() => `Page ${page} / ${totalPages}`, [page, totalPages]);

  /** ====== Handlers: open modals ====== */
  const openNew = () => {
    setNName(""); setNEmail(""); setNPwd(""); setNPwd2("");
    setNIsAdmin(false); setNIsCS(false);
    setShowNew(true);
    setTimeout(() => newNameRef.current?.focus(), 0);
  };

  const openEdit = (u: UserRow) => {
    setEUserId(u.user_id);
    setEName(u.full_name);
    setEEmail(u.email);
    setEIsAdmin(u.role === "admin");
    setEIsCS(u.role === "cs");
    setShowEdit(true);
  };

  const openPwd = (u: UserRow) => {
    setPUserId(u.user_id);
    setPName(u.full_name);
    setPPwd(""); setPPwd2("");
    setShowPwd(true);
  };

  const openResign = (u: UserRow) => {
    setRUserId(u.user_id);
    setRName(u.full_name);
    setRReason("");
    setShowResign(true);
  };

  /** ====== Submit: Create / Edit / ChangePwd / Resign ====== */
  const submitNew = async () => {
    if (!nName.trim() || !nEmail.trim() || !nPwd) { alert("Lengkapi Name, Email, Password"); return; }
    if (nPwd !== nPwd2) { alert("Konfirmasi password tidak sama"); return; }
    const role = nIsAdmin ? "admin" : nIsCS ? "cs" : "viewer";

    const res = await fetch("/api/admin/users/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: nName.trim(),
        email: nEmail.trim().toLowerCase(),
        password: nPwd,
        role,
      }),
    });
    if (!res.ok) { alert(await res.text()); return; }
    setShowNew(false);
    await load(1);
  };

  const submitEdit = async () => {
    if (!eUserId) return;
    if (!eName.trim() || !eEmail.trim()) { alert("Lengkapi Name & Email"); return; }
    const role = eIsAdmin ? "admin" : eIsCS ? "cs" : "viewer";

    const res = await fetch("/api/admin/users/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: eUserId,
        full_name: eName.trim(),
        email: eEmail.trim().toLowerCase(),
        role,
      }),
    });
    if (!res.ok) { alert(await res.text()); return; }
    setShowEdit(false);
    await load(page);
  };

  const submitPwd = async () => {
    if (!pUserId) return;
    if (!pPwd || pPwd !== pPwd2) { alert("Password & konfirmasi harus sama"); return; }

    const res = await fetch("/api/admin/users/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: pUserId, password: pPwd }),
    });
    if (!res.ok) { alert(await res.text()); return; }
    setShowPwd(false);
  };

  const submitResign = async () => {
    if (!rUserId) return;
    const res = await fetch("/api/admin/users/resign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: rUserId, reason: rReason || null }),
    });
    if (!res.ok) { alert(await res.text()); return; }
    setShowResign(false);
    await load(page);
  };

  /** ====== Guard render ====== */
  if (authorized === "loading") return <div className="p-6">Loading…</div>;
  if (authorized === "no") {
    return (
      <div className="p-6">
        <div className="text-red-600 font-semibold mb-2">Unauthorized</div>
        <div>Halaman ini hanya untuk Admin.</div>
      </div>
    );
  }
  
  /** ====== Render ====== */
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="rounded border bg-white p-3 text-sm">
        <b>Users — {tenantName}</b>
      </div>

      <div className="overflow-auto rounded border bg-white">
        <form
          onSubmit={applySearch}
          onKeyDown={(e) => { if (searchGuard.submitting && e.key === "Enter") e.preventDefault(); }}
        >
          <table className="table-grid min-w-[1000px]" style={{ borderCollapse: "collapse" }}>
            <thead>
              {/* Top-right button */}
              <tr>
                <th colSpan={7} className="text-right p-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (myRole !== "admin") { alert("Hanya admin yang bisa membuat user"); return; }
                      openNew();
                    }}
                    className={`rounded px-3 py-1 text-white ${myRole==="admin" ? "bg-blue-600" : "bg-gray-400 cursor-not-allowed"}`}
                    disabled={myRole !== "admin"}
                  >
                    New User
                  </button>
                </th>
              </tr>

              {/* Filter/Search bar */}
              <tr className="filters">
                <th className="w-20" />
                <th className="w-64">
                  <input
                    placeholder="Cari name/email"
                    value={search}
                    onChange={(e)=>setSearch(e.target.value)}
                    className="border rounded px-2 py-1 w-full"
                  />
                </th>
                <th />
                <th />
                <th />
                <th />
                <th className="text-right pr-3">
                  <button
                    className="rounded bg-blue-600 text-white px-3 py-1 disabled:opacity-60"
                    disabled={loading || searchGuard.submitting}
                    aria-disabled={loading || searchGuard.submitting}
                  >
                    {searchGuard.submitting ? "Loading…" : "submit"}
                  </button>
                </th>
              </tr>

              {/* Header kolom */}
              <tr>
                <th className="text-left w-20">ID</th>
                <th className="text-left w-[280px]">Name</th>
                <th className="text-left w-[260px]">Email</th>
                <th className="text-left w-24">Admin</th>
                <th className="text-left w-24">CS</th>
                <th className="text-left w-36">Action</th>
                <th className="text-left w-36">Created</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr><td colSpan={7}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7}>No data</td></tr>
              ) : (
                rows.map((u) => {
                  const isAdmin = (u.role ?? "").toLowerCase() === "admin";
                  const isCS = (u.role ?? "").toLowerCase() === "cs";
                  const created = new Date(u.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

                  return (
                    <tr key={u.user_id}>
                      <td>{u.seq_id}</td>
                      <td className="whitespace-normal break-words">{u.full_name}</td>
                      <td className="whitespace-normal break-words">{u.email}</td>
                      <td>{String(isAdmin)}</td>
                      <td>{String(isCS)}</td>
                      <td>
                        {u.is_resigned ? (
                          <span className="text-gray-500">RESIGN</span>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              className="h-8 min-w-[52px] px-3 rounded bg-blue-600 text-white"
                              onClick={() => {
                                if (myRole !== "admin") { alert("Hanya admin"); return; }
                                openEdit(u);
                              }}
                              disabled={myRole !== "admin"}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="h-8 min-w-[52px] px-3 rounded bg-blue-600 text-white"
                              onClick={() => {
                                if (myRole !== "admin") { alert("Hanya admin"); return; }
                                openPwd(u);
                              }}
                              disabled={myRole !== "admin"}
                              title="Change password"
                            >
                              Password
                            </button>
                            <button
                              type="button"
                              className="h-8 min-w-[52px] px-3 rounded bg-blue-600 text-white"
                              onClick={() => {
                                if (myRole !== "admin") { alert("Hanya admin"); return; }
                                openResign(u);
                              }}
                              disabled={myRole !== "admin"}
                            >
                              Resign
                            </button>
                          </div>
                        )}
                      </td>
                      <td>{created}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </form>
      </div>

      {/* Pagination */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button onClick={() => page>1 && load(1)} disabled={page<=1} className="px-3 py-1 rounded border bg-white disabled:opacity-50">First</button>
          <button onClick={() => page>1 && load(page-1)} disabled={page<=1} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Previous</button>
          <span className="px-3 py-1 rounded border bg-white">{pageLabel}</span>
          <button onClick={() => page<totalPages && load(page+1)} disabled={page>=totalPages} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Next</button>
          <button onClick={() => page<totalPages && load(totalPages)} disabled={page>=totalPages} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Last</button>
        </nav>
      </div>

      {/* ===== Modal: New User ===== */}
      {showNew && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
             onMouseDown={(e)=>{ if (newGuard.submitting) return; if(e.currentTarget===e.target) setShowNew(false); }}>
          <form
            onSubmit={(e)=>{ e.preventDefault(); newGuard.run(submitNew); }}
            onKeyDown={(e)=>{ if (newGuard.submitting && e.key === "Enter") e.preventDefault(); }}
            className="bg-white rounded border w-full max-w-xl mt-10">
            <div className="p-4 border-b font-semibold">Create New user — {tenantName}</div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Name</label>
                <input ref={newNameRef} className="border rounded px-3 py-2 w-full"
                       value={nName} onChange={(e)=>setNName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs mb-1">Email</label>
                <input className="border rounded px-3 py-2 w-full" type="email"
                       value={nEmail} onChange={(e)=>setNEmail(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs mb-1">Password</label>
                  <input className="border rounded px-3 py-2 w-full" type="password"
                         value={nPwd} onChange={(e)=>setNPwd(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs mb-1">Confirm Password</label>
                  <input className="border rounded px-3 py-2 w-full" type="password"
                         value={nPwd2} onChange={(e)=>setNPwd2(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={nIsCS} onChange={(e)=>setNIsCS(e.target.checked)} />
                  <span>Is CS</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={nIsAdmin} onChange={(e)=>setNIsAdmin(e.target.checked)} />
                  <span>Is Admin</span>
                </label>
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={()=>setShowNew(false)}
                      className="rounded px-4 py-2 bg-gray-100"
                      disabled={newGuard.submitting} aria-disabled={newGuard.submitting}>
                Close
              </button>
              <button type="submit"
                      className="rounded px-4 py-2 bg-blue-600 text-white disabled:opacity-60"
                      disabled={newGuard.submitting} aria-disabled={newGuard.submitting}
                      title={newGuard.submitting ? "Submitting..." : "Submit"}>
                {newGuard.submitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Modal: Edit User ===== */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
             onMouseDown={(e)=>{ if (editGuard.submitting) return; if(e.currentTarget===e.target) setShowEdit(false); }}>
          <form
            onSubmit={(e)=>{ e.preventDefault(); editGuard.run(submitEdit); }}
            onKeyDown={(e)=>{ if (editGuard.submitting && e.key === "Enter") e.preventDefault(); }}
            className="bg-white rounded border w-full max-w-xl mt-10">
            <div className="p-4 border-b font-semibold">Edit user</div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Name</label>
                <input className="border rounded px-3 py-2 w-full"
                       value={eName} onChange={(e)=>setEName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs mb-1">Email</label>
                <input className="border rounded px-3 py-2 w-full" type="email"
                       value={eEmail} onChange={(e)=>setEEmail(e.target.value)} />
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={eIsCS} onChange={(e)=>setEIsCS(e.target.checked)} />
                  <span>Is CS</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={eIsAdmin} onChange={(e)=>setEIsAdmin(e.target.checked)} />
                  <span>Is Admin</span>
                </label>
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={()=>setShowEdit(false)}
                      className="rounded px-4 py-2 bg-gray-100"
                      disabled={editGuard.submitting} aria-disabled={editGuard.submitting}>
                Close
              </button>
              <button type="submit"
                      className="rounded px-4 py-2 bg-blue-600 text-white disabled:opacity-60"
                      disabled={editGuard.submitting} aria-disabled={editGuard.submitting}
                      title={editGuard.submitting ? "Submitting..." : "Submit"}>
                {editGuard.submitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Modal: Change Password ===== */}
      {showPwd && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
             onMouseDown={(e)=>{ if (pwdGuard.submitting) return; if(e.currentTarget===e.target) setShowPwd(false); }}>
          <form
            onSubmit={(e)=>{ e.preventDefault(); pwdGuard.run(submitPwd); }}
            onKeyDown={(e)=>{ if (pwdGuard.submitting && e.key === "Enter") e.preventDefault(); }}
            className="bg-white rounded border w-full max-w-xl mt-10">
            <div className="p-4 border-b font-semibold">Edit Password for {pName}</div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Password</label>
                <input className="border rounded px-3 py-2 w-full" type="password"
                       value={pPwd} onChange={(e)=>setPPwd(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs mb-1">Confirm Password</label>
                <input className="border rounded px-3 py-2 w-full" type="password"
                       value={pPwd2} onChange={(e)=>setPPwd2(e.target.value)} />
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={()=>setShowPwd(false)}
                      className="rounded px-4 py-2 bg-gray-100"
                      disabled={pwdGuard.submitting} aria-disabled={pwdGuard.submitting}>
                Close
              </button>
              <button type="submit"
                      className="rounded px-4 py-2 bg-blue-600 text-white disabled:opacity-60"
                      disabled={pwdGuard.submitting} aria-disabled={pwdGuard.submitting}
                      title={pwdGuard.submitting ? "Submitting..." : "Submit"}>
                {pwdGuard.submitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Modal: Resign ===== */}
      {showResign && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
             onMouseDown={(e)=>{ if (resignGuard.submitting) return; if(e.currentTarget===e.target) setShowResign(false); }}>
          <form
            onSubmit={(e)=>{ e.preventDefault(); resignGuard.run(submitResign); }}
            onKeyDown={(e)=>{ if (resignGuard.submitting && e.key === "Enter") e.preventDefault(); }}
            className="bg-white rounded border w-full max-w-xl mt-10">
            <div className="p-4 border-b font-semibold">Tandai Resign untuk {rName}</div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Alasan Resign</label>
                <textarea rows={3} className="border rounded px-3 py-2 w-full"
                          value={rReason} onChange={(e)=>setRReason(e.target.value)} />
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={()=>setShowResign(false)}
                      className="rounded px-4 py-2 bg-gray-100"
                      disabled={resignGuard.submitting} aria-disabled={resignGuard.submitting}>
                Close
              </button>
              <button type="submit"
                      className="rounded px-4 py-2 bg-blue-600 text-white disabled:opacity-60"
                      disabled={resignGuard.submitting} aria-disabled={resignGuard.submitting}
                      title={resignGuard.submitting ? "Submitting..." : "Submit"}>
                {resignGuard.submitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
