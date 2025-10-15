// lib/get-tenant-brand.ts
import { supabaseServer } from "@/lib/supabase-server";

export async function getTenantBrand(): Promise<string> {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // fallback jika belum login / data tidak ditemukan
  const fallback = process.env.NEXT_PUBLIC_DEFAULT_BRAND || "Tenant";

  if (!user) return fallback;

  // Ambil tenant dari profil user
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, tenant_name")
    .eq("user_id", user.id)
    .single();

  // Jika profile sudah menyimpan nama tenant langsung
  if (profile?.tenant_name) return profile.tenant_name;

  // Jika ada tenant_id, ambil dari tabel tenants
  if (profile?.tenant_id) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("brand, name") // sesuaikan jika kolomnya berbeda
      .eq("id", profile.tenant_id)
      .single();

    // Jika Anda menyimpan brand di kolom JSON website.brand
    const nameFromWebsite =
      (tenant as any)?.website?.brand ?? undefined;

    return (nameFromWebsite as string) || tenant?.brand || tenant?.name || fallback;
  }

  return fallback;
}
