import { supabaseServer } from "@/lib/supabase-server";
import UserMenu from "@/components/user-menu";
import ThemeToggle from "@/components/theme-toggle";

export default async function Header() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  let fullName = "User";
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, role")
      .eq("user_id", user.id)
      .single();
    fullName = data?.full_name ?? user.email ?? "User";
  }

  return (
    <header className="w-full border-b bg-white">
      <div className="px-4 h-14 flex items-center justify-between">
        <div className="font-semibold">Bracket BANK</div>
        <div className="flex items-center gap-4">
          <ThemeToggle />            {/* ⬅️ tombol dark mode */}
          <UserMenu fullName={fullName} />
        </div>
      </div>
    </header>
  );
}
