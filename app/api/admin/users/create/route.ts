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

    // 1) Create user di Auth (email confirmed)
    const { data: created, error: e1 } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { tenant_id: tenantId },
    });
    if (e1) {
      const msg = (e1.message || "").toLowerCase();
      if (msg.includes("already") && msg.includes("registered")) {
        return new Response("Email sudah terdaftar.", { status: 409 });
      }
      return new Response(`Auth error: ${e1.message}`, { status: 400 });
    }
    const user = created.user!;
    const uid = user.id;

    // 2) (Jaga-jaga) sinkronkan app_metadata.tenant_id bila createUser mengabaikannya
    const metaTenant = (user.app_metadata as any)?.tenant_id;
    if (metaTenant !== tenantId) {
      const { error: eMeta } = await supabaseAdmin.auth.admin.updateUserById(uid, {
        app_metadata: { ...(user.app_metadata as any), tenant_id: tenantId },
      } as any);
      if (eMeta) return new Response(`Auth meta error: ${eMeta.message}`, { status: 400 });
    }

    // 3) Idempotent: UPSERT profiles → paksa tenant & role yang benar
    const { error: e2 } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          user_id: uid,
          tenant_id: tenantId,
          full_name,
          role, // "admin" | "cs" | "viewer"
          created_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    if (e2) return new Response(`DB error (profiles upsert): ${e2.message}`, { status: 400 });

    return Response.json({ ok: true, user_id: uid });
  } catch (err: any) {
    return err instanceof Response ? err : new Response("Server error creating new user", { status: 500 });
  }
}
