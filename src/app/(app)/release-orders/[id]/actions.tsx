"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Send, CheckCircle2, XCircle, FilePen, Ban, CalendarPlus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { submitROAction, approveROAction, rejectROAction, amendROAction, cancelROAction, placeSpotsAction, invoiceROAction } from "@/app/actions/sales";

export function ROActions({ id, status, perms, stageName, bookedUnplaced, billable }: { id: string; status: string; perms: { manage: boolean; approve: boolean; cancel: boolean; schedule: boolean; invoice: boolean }; stageName?: string; bookedUnplaced: number; billable: number }) {
  const router = useRouter();
  const draft = ["DRAFT", "REJECTED"].includes(status);
  return (
    <div className="flex flex-wrap gap-2">
      {perms.manage && draft && (
        <Button size="sm" variant="secondary" asChild>
          <Link href={`/release-orders/${id}?edit=1`}>
            <Pencil /> Edit
          </Link>
        </Button>
      )}
      {perms.manage && draft && <ConfirmAction icon={<Send />} label="Submit" variant="default" title="Submit for approval?" description="Inventory availability is checked for every line. The RO is locked while it is being approved." action={() => submitROAction(id)} />}
      {perms.approve && <ConfirmAction icon={<CheckCircle2 />} label={`Approve (${stageName})`} variant="default" title={`Approve at ${stageName}?`} description="At the final stage, matching inventory is booked atomically. If any line cannot be fully booked, nothing is booked." action={(c) => approveROAction(id, c)} reason="optional" />}
      {perms.approve && <ConfirmAction icon={<XCircle />} label="Reject" title="Reject this release order?" action={(c) => rejectROAction(id, c)} reason="required" danger />}
      {perms.schedule && ["APPROVED", "SCHEDULED"].includes(status) && bookedUnplaced > 0 && <ConfirmAction icon={<CalendarPlus />} label={`Place ${bookedUnplaced} spot(s)`} variant="default" title="Place booked spots on the schedule?" description="Each booked position gets the line's commercial. Every placement is checked against the scheduling rules; rejected placements are listed." action={() => placeSpotsAction(id)} />}
      {perms.invoice && ["APPROVED", "SCHEDULED", "COMPLETED"].includes(status) && billable > 0 && <ConfirmAction icon={<Receipt />} label={`Invoice ${billable} aired spot(s)`} title="Create a draft invoice?" description="Spots already invoiced are excluded automatically, so nothing can be billed twice." action={() => invoiceROAction(id)} onDone={(d) => router.push(`/invoices/${(d as { id: string }).id}`)} />}
      {perms.manage && ["APPROVED", "SCHEDULED"].includes(status) && <ConfirmAction icon={<FilePen />} label="Amend" title="Start a controlled amendment?" description="A snapshot of the current revision is kept. The RO returns to draft as a new revision and must be re-approved. Existing bookings are kept." action={(c) => amendROAction(id, c)} reason="required" />}
      {perms.cancel && !["CANCELLED", "COMPLETED"].includes(status) && <ConfirmAction icon={<Ban />} label="Cancel" title="Cancel this release order?" description="Unaired spots are removed from the schedule and the inventory is released." action={(c) => cancelROAction(id, c)} reason="required" danger />}
    </div>
  );
}
