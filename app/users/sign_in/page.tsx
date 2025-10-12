"use client";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function SignInPage() {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setErr(error.message);
    } else {
      router.push(search.get("redirectedFrom") || "/");
    }
  };

  return (
    <div className="min-h-screen flex items-start sm:items-center justify-center bg-gray-50 p-6">
      <form onSubmit={onSubmit} className="w-full max-w-md bg-white rounded border p-6 mt-16 sm:mt-0">
        <h1 className="text-lg font-semibold mb-4">Login</h1>
        <label className="block text-sm mb-1">Email</label>
        <input
          value={email} onChange={e=>setEmail(e.target.value)} type="email" required
          className="w-full border rounded px-3 py-2 mb-3 focus:outline-none focus:ring"
          placeholder="you@company.com"
        />
        <label className="block text-sm mb-1">Password</label>
        <input
          value={password} onChange={e=>setPassword(e.target.value)} type="password" required
          className="w-full border rounded px-3 py-2 mb-4 focus:outline-none focus:ring"
          placeholder="••••••••"
        />
        {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
        <button
          disabled={loading}
          className="w-full rounded bg-blue-600 text-white py-2 hover:bg-blue-700 disabled:opacity-60">
          {loading ? "Memproses..." : "Login"}
        </button>
        <p className="text-xs text-gray-500 mt-3">Tidak ada registrasi. Akun dibuat oleh admin.</p>
      </form>
    </div>
  );
}
