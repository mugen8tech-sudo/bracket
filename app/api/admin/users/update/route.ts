import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ensureAdmin } from "@/lib/ensure-admin";

export async function POST(req: NextRequest) {
  try {
    const { tenantId } = await ensureAdmin();
    const body = await req.json();
    const user_id: string = body?.user_id;
    const full_name: string = (body?.full_name ?? "").trim();
    const email: string = (body?.email ?? "").trim().toLowerCase();
    const roleRaw: string = (body?.role ?? "").toLowerCase();
    const role = roleRaw === "admin" ? "admin" : roleRaw === "cs" ? "cs" : "viewer";

    if (!user_id) return new Response("user_id required", { status: 400 });

    // guard: target user harus satu tenant
    const { data: target, error: e0 } = await supabaseAdmin
      .from("profiles").select("tenant_id").eq("user_id", user_id).single();
    if (e0 || !target || target.tenant_id !== tenantId)
      return new Response("Forbidden (cross-tenant)", { status: 403 });

    // update email di auth (opsional kalau sama)
    if (email) {
      const { error: e1 } = await supabaseAdmin.auth.admin.updateUserById(user_id, { email });
      if (e1) return new Response(e1.message, { status: 400 });
    }

    // update profile
    const { error: e2 } = await supabaseAdmin
      .from("profiles")
      .update({ full_name, role })
      .eq("user_id", user_id);
    if (e2) return new Response(e2.message, { status: 400 });

    return Response.json({ ok: true });
  } catch (err: any) {
    return err instanceof Response ? err : new Response("Server error", { status: 500 });
  }
}
