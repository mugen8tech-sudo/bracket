import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  // ambil profile (tenant + role)
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

  // pastikan run ini memang milik tenant user + status queued (RLS akan bantu)
  const { data: run, error: rErr } = await supabase
    .from("import_runs")
    .select("id, status")
    .eq("id", runId)
    .maybeSingle();

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 400 });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  if (String((run as any).status) !== "queued") {
    return NextResponse.json({ ok: false, reason: "not_queued", status: (run as any).status }, { status: 200 });
  }

  // call cron worker internal (pakai Authorization header supaya secret gak muncul di URL)
  const origin = new URL(req.url).origin;
  const cronUrl = `${origin}/api/public/cron/process-import-runs?run_id=${runId}&limit=1`;

  const secret = process.env.CRON_SECRET;
  const headers: Record<string, string> = {};
  if (secret) headers["authorization"] = `Bearer ${secret}`;

  const resp = await fetch(cronUrl, {
    method: "GET",
    headers,
    cache: "no-store",
  });

  const json = await resp.json().catch(() => ({}));
  return NextResponse.json({ ok: true, cron: json }, { status: 200 });
}
