import dynamic from "next/dynamic";
const CreditReport = dynamic(() => import("@/components/credit-report"), { ssr: false });

export default function Page() {
  return (
    <div className="p-4">
      <CreditReport />
    </div>
  );
}
