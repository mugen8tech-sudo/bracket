import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ensureAdmin } from "@/lib/ensure-admin";

export async function POST(req: NextRequest) {
  try {
    const { tenantId } = await ensureAdmin();
    const body = await req.json();
    const full_name: string = (body?.full_name ?? "").trim();
    const email: string = (body?.email ?? "").trim().toLowerCase();
    const password: string = body?.password ?? "";
    const roleRaw: string = (body?.role ?? "viewer").toLowerCase();

    if (!full_name || !email || !password) {
      return new Response("Name, email, password are required", { status: 400 });
    }
    const role = roleRaw === "admin" ? "admin" : roleRaw === "cs" ? "cs" : "viewer";

    // 1) create user in auth (email confirmed)
    const { data: created, error: e1 } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { tenant_id: tenantId }
    });
    if (e1) return new Response(e1.message, { status: 400 });
    const newUser = created.user;
    if (!newUser) return new Response("Cannot create user", { status: 400 });

    // 2) insert profiles with service role
    const { error: e2 } = await supabaseAdmin
      .from("profiles")
      .insert({
        user_id: newUser.id,
        tenant_id: tenantId,
        full_name,
        role,
        created_at: new Date().toISOString()
      });
    if (e2) return new Response(e2.message, { status: 400 });

    return Response.json({ ok: true, user_id: newUser.id });
  } catch (err: any) {
    return err instanceof Response ? err : new Response("Server error", { status: 500 });
  }
}
