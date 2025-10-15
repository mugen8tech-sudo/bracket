import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ensureAdmin } from "@/lib/ensure-admin";

export async function POST(req: NextRequest) {
  try {
    const { tenantId } = await ensureAdmin();
    const body = await req.json();
    const user_id: string = body?.user_id;
    const password: string = body?.password ?? "";

    if (!user_id || !password) return new Response("user_id & password required", { status: 400 });

    // guard tenant
    const { data: target, error: e0 } = await supabaseAdmin
      .from("profiles").select("tenant_id").eq("user_id", user_id).single();
    if (e0 || !target || target.tenant_id !== tenantId)
      return new Response("Forbidden (cross-tenant)", { status: 403 });

    const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, { password });
    if (error) return new Response(error.message, { status: 400 });

    return Response.json({ ok: true });
  } catch (err: any) {
    return err instanceof Response ? err : new Response("Server error", { status: 500 });
  }
}
