import { Suspense } from "react";
import SignInClient from "./sign-in-client";

// Hindari prerender statis untuk halaman login (selalu dinamis)
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-sm text-gray-600">Loading…</div>
        </div>
      }
    >
      <SignInClient />
    </Suspense>
  );
}
