import Header from "@/components/header";
import Sidebar from "@/components/sidebar";

export default function PrivateLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 px-4 py-6 bg-gray-50 min-h-[calc(100vh-56px)]">
          {children}
        </main>
      </div>
    </>
  );
}
