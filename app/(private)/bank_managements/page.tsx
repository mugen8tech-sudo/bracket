import BankManagement from "@/components/bank-management";

export default function Page() {
  // Server component wrapper (halaman) yang merender komponen client
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Bank Management</h1>
      <BankManagement />
    </div>
  );
}
