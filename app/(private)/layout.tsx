import Header from "@/components/header";
import Sidebar from "@/components/sidebar";

export default function PrivateLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-auto bg-gray-50">
      <div className="w-fit min-w-full">
        <Header />
        <div className="flex">
          <Sidebar />
          <main className="flex-1 px-4 py-6 min-h-[calc(100vh-56px)]">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
