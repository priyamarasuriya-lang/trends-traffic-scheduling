import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { addDays, format, parseISO } from "date-fns";

export type ChannelTime = { timezone: string; broadcastDayStartHour: number };

const pad = (n: number) => String(n).padStart(2, "0");

/** Convert a wall-clock time in a zone to a UTC instant. DST gaps resolve forward. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  return fromZonedTime(`${date}T${time.length === 5 ? `${time}:00` : time}`, tz);
}

/** UTC [start, end) of a broadcast day. Length is 23/24/25h across DST changes. */
export function broadcastDayRange(ch: ChannelTime, date: string): { start: Date; end: Date } {
  const start = zonedToUtc(date, `${pad(ch.broadcastDayStartHour)}:00:00`, ch.timezone);
  const next = format(addDays(parseISO(date), 1), "yyyy-MM-dd");
  const end = zonedToUtc(next, `${pad(ch.broadcastDayStartHour)}:00:00`, ch.timezone);
  return { start, end };
}

/** Broadcast date (YYYY-MM-DD) an instant belongs to on a channel. */
export function broadcastDateOf(ch: ChannelTime, instant: Date): string {
  const local = toZonedTime(instant, ch.timezone);
  if (local.getHours() < ch.broadcastDayStartHour) return format(addDays(local, -1), "yyyy-MM-dd");
  return format(local, "yyyy-MM-dd");
}

export const fmtTz = (d: Date | string, tz: string, f = "HH:mm:ss") => formatInTimeZone(typeof d === "string" ? new Date(d) : d, tz, f);

/** Seconds since local midnight for an instant in a zone. */
export function localSecondOfDay(d: Date, tz: string): number {
  const [h, m, s] = formatInTimeZone(d, tz, "HH:mm:ss").split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}

/** Parse "HH:MM:SS", "MM:SS" or plain seconds into integer seconds. */
export function parseDuration(input: string): number | null {
  const t = input.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p) || p < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export const todayIn = (tz: string) => formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
export const addDaysStr = (date: string, n: number) => format(addDays(parseISO(date), n), "yyyy-MM-dd");
export const fmtDate = (d: Date | string | null | undefined) => (d ? format(typeof d === "string" ? new Date(d) : d, "dd MMM yyyy") : "—");
export const fmtDateTime = (d: Date | string | null | undefined) => (d ? format(typeof d === "string" ? new Date(d) : d, "dd MMM yyyy HH:mm") : "—");
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
