import { requirePage } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ROForm } from "@/components/sales/forms";
import { salesOptions } from "@/lib/sales/options";

export const metadata = { title: "New release order" };

export default async function NewRO() {
  const user = await requirePage("ro.manage");
  return (
    <div>
      <PageHeader title="New release order" description="Saved as a draft. Submitting checks inventory availability; approval books the inventory." />
      <Card>
        <CardBody>
          <ROForm id={null} opts={await salesOptions(user)} />
        </CardBody>
      </Card>
    </div>
  );
}
