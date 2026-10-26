import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { formatDuration } from "@/lib/time";
import { AssetForm, type AssetInitial } from "../form";
import { assetOptions } from "../options";

export const metadata = { title: "Media asset" };

export default async function NewAsset({ searchParams }: { searchParams: Promise<{ category?: string; edit?: string }> }) {
  await requirePage("media.manage");
  const { category, edit } = await searchParams;
  const opts = await assetOptions();
  let initial: AssetInitial = { category: category ?? "PROGRAM" };
  if (edit) {
    const a = await prisma.mediaAsset.findUnique({ where: { id: edit }, include: { program: true, movie: true, commercial: true, promo: true } });
    if (!a || a.deletedAt) notFound();
    const { program, movie, commercial, promo, ...base } = a;
    const flat: Record<string, unknown> = { ...base, ...program, ...movie, ...commercial, ...promo, id: a.id, duration: formatDuration(a.durationSec) };
    // Only plain values go to the client form.
    initial = Object.fromEntries(Object.entries(flat).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v) || Array.isArray(v))) as AssetInitial;
  }
  return (
    <div className="max-w-4xl">
      <PageHeader title={edit ? `Edit ${initial.title}` : "New media asset"} description="New assets start as pending and must be approved before they can be scheduled." />
      <Card>
        <CardBody>
          <AssetForm id={edit ?? null} initial={initial} {...opts} />
        </CardBody>
      </Card>
    </div>
  );
}
