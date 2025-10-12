import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";

/**
 * Supabase client untuk Server Components.
 * Library akan membaca cookie auth dari Next `cookies()`.
 */
export const supabaseServer = () => {
  return createServerComponentClient({ cookies });
};
