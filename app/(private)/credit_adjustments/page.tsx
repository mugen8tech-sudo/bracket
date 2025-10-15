import dynamic from "next/dynamic";

const CreditAdjustment = dynamic(() => import("@/components/credit-adjustment"), { ssr: false });

export default function Page() {
  return (
    <div className="p-4">
      <CreditAdjustment />
    </div>
  );
}
