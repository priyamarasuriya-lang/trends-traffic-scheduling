// Default local-time bands used for inventory pricing and RO matching.
export const TIME_BANDS = [
  { key: "PRIME", label: "Prime (19:00–23:00)", start: 19 * 60, end: 23 * 60 },
  { key: "DAY", label: "Day (06:00–19:00)", start: 6 * 60, end: 19 * 60 },
  { key: "LATE", label: "Late (23:00–06:00)", start: 23 * 60, end: 6 * 60 },
] as const;

export function timeBandFor(minuteOfDay: number): string {
  for (const b of TIME_BANDS) {
    const inside = b.start <= b.end ? minuteOfDay >= b.start && minuteOfDay < b.end : minuteOfDay >= b.start || minuteOfDay < b.end;
    if (inside) return b.key;
  }
  return "DAY";
}
