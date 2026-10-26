import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default async function Forbidden({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const { need } = await searchParams;
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <ShieldAlert className="mx-auto size-10 text-danger" />
      <h1 className="mt-3 text-lg font-semibold">Access denied</h1>
      <p className="mt-1 text-sm text-muted">Your role does not include {need ? <code>{need}</code> : "the permission"} needed for this page. Ask an administrator if you need access.</p>
      <Link href="/dashboard" className="mt-4 inline-block text-primary hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
