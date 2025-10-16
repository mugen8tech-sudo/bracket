// /lib/ensure-admin.ts
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export type AdminContext = { userId: string; tenantId: string };

export async function ensureAdmin(): Promise<AdminContext> {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Response("Unauthorized", { status: 401 });

  const { data: me, error } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .single();

  if (error || !me?.tenant_id) throw new Response("Profile not found", { status: 403 });
  if ((me.role ?? "").toLowerCase() !== "admin")
    throw new Response("Forbidden: admin only", { status: 403 });

  return { userId: user.id, tenantId: me.tenant_id };
}
