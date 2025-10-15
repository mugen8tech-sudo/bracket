import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ensureAdmin } from "@/lib/ensure-admin";

const LONG_BAN = "876000h"; // ~100 tahun

export async function POST(req: NextRequest) {
  try {
    const { tenantId, userId: adminId } = await ensureAdmin();
    const body = await req.json();
    const user_id: string = body?.user_id;
    const reason: string = (body?.reason ?? "").trim();

    if (!user_id) return new Response("user_id required", { status: 400 });

    // guard tenant
    const { data: target, error: e0 } = await supabaseAdmin
      .from("profiles").select("tenant_id").eq("user_id", user_id).single();
    if (e0 || !target || target.tenant_id !== tenantId)
      return new Response("Forbidden (cross-tenant)", { status: 403 });

    // 1) flag resign di profiles
    const { error: e1 } = await supabaseAdmin
      .from("profiles")
      .update({
        is_resigned: true,
        resigned_at: new Date().toISOString(),
        resigned_reason: reason || null,
        resigned_by: adminId
      })
      .eq("user_id", user_id);
    if (e1) return new Response(e1.message, { status: 400 });

    // 2) ban user di auth (tidak bisa login)
    const { error: e2 } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
      ban_duration: LONG_BAN,
    } as any);
    if (e2) return new Response(e2.message, { status: 400 });

    return Response.json({ ok: true });
  } catch (err: any) {
    return err instanceof Response ? err : new Response("Server error", { status: 500 });
  }
}
