import { supabaseServer } from "@/lib/supabase-server";

export default async function Header() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  // Ambil nama dari profiles
  let fullName = "";
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
      <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between">
        <div className="font-semibold">Bracket BANK — <span className="text-sm text-gray-500">TECH</span></div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-700">{fullName}</span>
          <form action="/api/auth/signout" method="post">
            <button className="rounded bg-gray-100 hover:bg-gray-200 px-3 py-1 text-sm">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
