"use client";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-border bg-surface p-6 text-center">
      <h2 className="text-lg font-semibold">This page could not be loaded</h2>
      <p className="mt-1 text-sm text-muted">An unexpected error occurred. It has been logged{error.digest ? ` (reference ${error.digest})` : ""}.</p>
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
