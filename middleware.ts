import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  // refresh session bila perlu
  const { data: { session } } = await supabase.auth.getSession();

  const isAuthPage = req.nextUrl.pathname.startsWith("/users/sign_in");
  if (!session && !isAuthPage) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/users/sign_in";
    redirectUrl.searchParams.set("redirectedFrom", req.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }
  if (session && isAuthPage) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/";
    return NextResponse.redirect(redirectUrl);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next|api/public|favicon.ico).*)"]
};
