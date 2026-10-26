"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { dealStatusAction, roFromDealAction } from "@/app/actions/sales";

export function DealActions({ id, status, canManage, canCreateRo }: { id: string; status: string; canManage: boolean; canCreateRo: boolean }) {
  const router = useRouter();
  if (!canManage && !canCreateRo) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canManage && !["CLOSED", "CANCELLED"].includes(status) && (
        <Button size="sm" variant="secondary" asChild>
          <Link href={`/deals/${id}?edit=1`}>
            <Pencil /> Edit
          </Link>
        </Button>
      )}
      {canManage && status === "DRAFT" && <ConfirmAction label="Start negotiation" title="Move to negotiation?" action={(c) => dealStatusAction(id, "NEGOTIATION", c)} reason="optional" />}
      {canManage && ["DRAFT", "NEGOTIATION"].includes(status) && <ConfirmAction label="Confirm deal" title="Confirm this deal?" description="Confirmed deals can be converted into release orders." action={(c) => dealStatusAction(id, "CONFIRMED", c)} reason="optional" variant="default" />}
      {canCreateRo && status === "CONFIRMED" && <ConfirmAction label="Create release order" title="Create a release order from this deal?" description="A draft RO is created with the deal's lines. Attach material and adjust dates before submitting." action={() => roFromDealAction(id)} variant="default" onDone={(d) => router.push(`/release-orders/${(d as { id: string }).id}`)} />}
      {canManage && status === "CONFIRMED" && <ConfirmAction label="Close" title="Close this deal?" action={(c) => dealStatusAction(id, "CLOSED", c)} reason="optional" />}
      {canManage && !["CLOSED", "CANCELLED"].includes(status) && <ConfirmAction label="Cancel deal" title="Cancel this deal?" action={(c) => dealStatusAction(id, "CANCELLED", c)} reason="required" danger />}
    </div>
  );
}
