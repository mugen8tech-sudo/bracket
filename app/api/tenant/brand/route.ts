// app/api/tenant/brand/route.ts
import { NextResponse } from "next/server";
import { getTenantBrand } from "@/lib/get-tenant-brand";

export const dynamic = "force-dynamic"; // jangan di-cache statis

export async function GET() {
  try {
    const brand = await getTenantBrand();
    return NextResponse.json({ brand });
  } catch {
    return NextResponse.json(
      { brand: process.env.NEXT_PUBLIC_DEFAULT_BRAND || "Tenant" },
      { status: 200 }
    );
  }
}
