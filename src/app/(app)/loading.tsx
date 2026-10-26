export default function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-56 animate-pulse rounded bg-surface-2" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-lg bg-surface-2" />
    </div>
  );
}
