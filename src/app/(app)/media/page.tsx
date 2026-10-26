import { requirePage } from "@/lib/auth/session";
import { MediaLibrary } from "./library";

export const metadata = { title: "Media Library" };

export default async function MediaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("media.view");
  return <MediaLibrary user={user} params={await searchParams} />;
}
