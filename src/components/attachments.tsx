import { prisma } from "@/lib/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { fmtDateTime } from "@/lib/time";
import { UploadButton } from "./upload-button";

export async function Attachments({ entityType, entityId, canUpload }: { entityType: string; entityId: string; canUpload: boolean }) {
  const files = await prisma.fileAttachment.findMany({ where: { entityType, entityId, deletedAt: null }, orderBy: { createdAt: "desc" } });
  return (
    <Card>
      <CardHeader title="Documents" actions={canUpload && <UploadButton entityType={entityType} entityId={entityId} />} />
      <CardBody className="space-y-1.5 text-sm">
        {files.length === 0 && <p className="text-muted">No documents attached.</p>}
        {files.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-2">
            <a href={`/api/files/${f.id}`} className="truncate text-primary hover:underline">
              {f.fileName}
            </a>
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
              {Math.ceil(f.sizeBytes / 1024)} KB · {fmtDateTime(f.createdAt)} <StatusBadge status={f.scanStatus} />
            </span>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
