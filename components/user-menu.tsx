"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function UserMenu({ fullName }: { fullName: string }) {
  const supabase = supabaseBrowser();
  const [open, setOpen] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Tutup dropdown saat klik di luar & ESC untuk dropdown/modal
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showPwd) setShowPwd(false);
        else setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [showPwd]);

  const submitPwd = async () => {
    if (!pwd) { alert("Password wajib diisi"); return; }
    if (pwd !== pwd2) { alert("Konfirmasi password tidak sama"); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setBusy(false);
    if (error) { alert(error.message); return; }
    setShowPwd(false);
    setPwd(""); setPwd2("");
    alert("Password berhasil diubah.");
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="rounded bg-gray-100 hover:bg-gray-200 px-3 py-1 text-sm"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {fullName}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-44 rounded border bg-white shadow-md z-50">
          <button
            className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => { setOpen(false); setShowPwd(true); }}
          >
            Password
          </button>
          <form action="/api/auth/signout" method="post">
            <button className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
              Sign out
            </button>
          </form>
        </div>
      )}

      {/* Modal Ubah Password */}
      {showPwd && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4 z-50"
          onMouseDown={(e) => { if (e.currentTarget === e.target) setShowPwd(false); }}
        >
          <form
            onSubmit={(e) => { e.preventDefault(); submitPwd(); }}
            className="bg-white rounded border w-full max-w-md mt-20"
          >
            <div className="p-4 border-b font-semibold">Ubah Password</div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Password</label>
                <input
                  type="password"
                  className="border rounded px-3 py-2 w-full"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Confirm Password</label>
                <input
                  type="password"
                  className="border rounded px-3 py-2 w-full"
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPwd(false)}
                className="rounded px-4 py-2 bg-gray-100"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded px-4 py-2 bg-blue-600 text-white"
              >
                {busy ? "Saving..." : "Submit"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
