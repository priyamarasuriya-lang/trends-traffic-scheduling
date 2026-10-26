import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { CATEGORY_META, SLUG_TO_CATEGORY } from "@/lib/categories";
import { MediaLibrary } from "../library";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const cat = SLUG_TO_CATEGORY[(await params).slug];
  return { title: cat ? CATEGORY_META[cat].plural : "Media" };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("media.view");
  const cat = SLUG_TO_CATEGORY[(await params).slug];
  if (!cat) notFound();
  return <MediaLibrary user={user} category={cat} params={await searchParams} />;
}
