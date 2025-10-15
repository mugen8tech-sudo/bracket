import dynamic from "next/dynamic";
const UserManagement = dynamic(() => import("@/components/user-management"), { ssr: false });

export default function Page() {
  return (
    <div className="p-4">
      <UserManagement />
    </div>
  );
}
