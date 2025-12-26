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
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (pErr || !prof) return NextResponse.json({ error: "Profile not found" }, { status: 403 });

  const role = String((prof as any).role || "").toLowerCase();
  if (!ALLOWED.has(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // RLS akan memastikan user cuma bisa baca run tenant sendiri
  const { data: run, error: rErr } = await supabase
    .from("export_runs")
    .select("id, status, storage_bucket, storage_path, file_name")
    .eq("id", runId)
    .maybeSingle();

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 400 });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  if (String((run as any).status) !== "done") {
    return NextResponse.json({ error: "File belum siap (status bukan DONE)." }, { status: 400 });
  }

  const bucket = String((run as any).storage_bucket || "import_exports");
  const path = String((run as any).storage_path || "");
  const fname = String((run as any).file_name || "export.xlsx");
  if (!path) return NextResponse.json({ error: "storage_path kosong." }, { status: 400 });

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 10, { download: fname });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, url: data.signedUrl, file_name: fname }, { status: 200 });
}
