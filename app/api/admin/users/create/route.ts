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
    const role = roleRaw === "admin" ? "admin" : roleRaw === "cs" ? "cs" : "viewer";

    if (!full_name || !email || !password) {
      return new Response("Name, email, password are required", { status: 400 });
    }

    // 1) Buat user di Auth
    const { data: created, error: e1 } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { tenant_id: tenantId }
    });
    if (e1) {
      const msg = (e1.message || "").toLowerCase();
      if (msg.includes("already") && msg.includes("registered")) {
        return new Response("Email sudah terdaftar.", { status: 409 });
      }
      return new Response(e1.message, { status: 400 });
    }
    const newUser = created.user!;
    const uid = newUser.id;

    // 2) Jika trigger sudah membuat row profiles, pastikan tetap tenant yang sama
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", uid)
      .maybeSingle();

    if (existing && existing.tenant_id && existing.tenant_id !== tenantId) {
      return new Response("Akun sudah terhubung ke tenant lain.", { status: 409 });
    }

    // 3) UPSERT supaya idempotent (hindari duplicate key pkey)
    const { error: e2 } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          user_id: uid,
          tenant_id: tenantId,
          full_name,
          role,
          created_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    if (e2) return new Response(e2.message, { status: 400 });

    return Response.json({ ok: true, user_id: uid });
  } catch (err: any) {
    return err instanceof Response ? err : new Response("Server error", { status: 500 });
  }
}
