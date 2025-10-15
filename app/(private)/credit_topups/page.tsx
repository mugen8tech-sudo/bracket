import dynamic from "next/dynamic";
const CreditTopup = dynamic(() => import("@/components/credit-topup"), { ssr: false });

export default function Page() {
  return (
    <div className="p-4">
      <CreditTopup />
    </div>
  );
}
