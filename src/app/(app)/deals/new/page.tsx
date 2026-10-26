import { requirePage } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { DealForm } from "@/components/sales/forms";
import { salesOptions } from "@/lib/sales/options";

export const metadata = { title: "New deal" };

export default async function NewDeal() {
  const user = await requirePage("deal.manage");
  return (
    <div>
      <PageHeader title="New deal" description="Totals are recalculated on the server with exact decimal arithmetic when you save." />
      <Card>
        <CardBody>
          <DealForm id={null} opts={await salesOptions(user)} />
        </CardBody>
      </Card>
    </div>
  );
}
