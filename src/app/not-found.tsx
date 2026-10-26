import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center p-6 text-center">
      <div>
        <p className="text-5xl font-bold text-muted">404</p>
        <p className="mt-2">That record or page does not exist.</p>
        <Link href="/dashboard" className="mt-4 inline-block text-primary hover:underline">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
