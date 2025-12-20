import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["admin", "operator", "cs", "cs_dp", "cs_wd"]);

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const runId = Number(body?.runId);
  if (!runId || !Number.isFinite(runId)) {
    return NextResponse.json({ error: "Invalid runId" }, { status: 400 });
  }

  const { data: prof, error: pErr } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .single();

  if (pErr || !prof?.tenant_id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 403 });
  }

  const role = String((prof as any).role || "").toLowerCase();
  if (!ALLOWED.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenantId = String((prof as any).tenant_id);

  // cancel hanya kalau masih QUEUED (biar gak race sama processing)
  const { data, error } = await supabaseAdmin
    .from("import_runs")
    .update({
      status: "cancelled",
      finished_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", runId)
    .eq("tenant_id", tenantId)
    .eq("status", "queued")
    .select("id, status")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!data) {
    return NextResponse.json({ ok: false, reason: "not_queued_or_not_found" }, { status: 200 });
  }

  return NextResponse.json({ ok: true, run: data }, { status: 200 });
}
