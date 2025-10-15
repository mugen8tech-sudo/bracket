"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseServer } from "@/lib/supabase-server";

export default async function Header() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const [tenantName, setTenantName] = useState<string>("");
  const [tenantId, setTenantId] = useState<string>("");
  // bootstrap tenant info
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("user_id", user?.id).single();
      const tid = prof?.tenant_id ?? "";
      setTenantId(tid);
      if (tid) {
        const { data: t } = await supabase.from("tenants").select("name").eq("id", tid).single();
        setTenantName(t?.name ?? "");
      }
    })();
  }, [supabase]);

  let fullName = "";
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, role")
      .eq("user_id", user.id)
      .single();
    fullName = data?.full_name ?? user.email ?? "User";
  }

  return (
    <header className="w-full border-b bg-white">
      <div className="px-4 h-14 flex items-center justify-between">
        <div className="font-semibold">
          Bracket BANK —{" "}
          <span className="text-sm text-gray-500">{tenantName}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-700">{fullName}</span>
          <form action="/api/auth/signout" method="post">
            <button className="rounded bg-gray-100 hover:bg-gray-200 px-3 py-1 text-sm">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
