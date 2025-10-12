import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });
  await supabase.auth.signOut();

  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  return NextResponse.redirect(new URL("/users/sign_in", origin));
}
