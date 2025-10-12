import Header from "@/components/header";

export default function PrivateLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </>
  );
}
