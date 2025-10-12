"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

/**
 * Supabase client untuk dipakai di Client Components (use client).
 * Mengambil URL & anon key dari env NEXT_PUBLIC_SUPABASE_URL/ANON_KEY.
 */
export const supabaseBrowser = () => createClientComponentClient();
