"use client";
import { useRouter } from "next/navigation";
import { Check, X, Archive, Trash2, Undo2 } from "lucide-react";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { setApprovalAction, deleteAssetAction } from "@/app/actions/media";

export function ApprovalButtons({ id, status, canApprove, canManage }: { id: string; status: string; canApprove: boolean; canManage: boolean }) {
  const router = useRouter();
  return (
    <>
      {canApprove && status !== "APPROVED" && status !== "RETIRED" && (
        <ConfirmAction label="Approve" icon={<Check />} variant="default" title="Approve this asset for air?" description="Approved assets can be placed on the schedule." reason="optional" action={(r) => setApprovalAction(id, "APPROVED", r)} />
      )}
      {canApprove && status === "PENDING" && <ConfirmAction label="Reject" icon={<X />} title="Reject this asset?" reason="required" danger action={(r) => setApprovalAction(id, "REJECTED", r)} />}
      {canManage && status !== "RETIRED" && <ConfirmAction label="Retire" icon={<Archive />} title="Retire this asset?" description="Retired assets stay in history but cannot be scheduled. Assets with future schedule slots cannot be retired." reason="optional" action={(r) => setApprovalAction(id, "RETIRED", r)} />}
      {canManage && status === "RETIRED" && <ConfirmAction label="Reinstate" icon={<Undo2 />} title="Reinstate this asset?" description="It goes back to pending approval." action={(r) => setApprovalAction(id, "PENDING", r)} />}
      {canManage && (
        <ConfirmAction label="Delete" icon={<Trash2 />} title="Delete this asset?" description="Only assets that were never scheduled or sold can be deleted." danger action={() => deleteAssetAction(id)} onDone={() => router.push("/media")} />
      )}
    </>
  );
}
