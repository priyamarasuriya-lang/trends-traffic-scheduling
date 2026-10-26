import { describe, it, expect } from "vitest";
import { broadcastDayRange, broadcastDateOf, zonedToUtc, parseDuration, formatDuration } from "@/lib/time";

describe("broadcast days and time zones", () => {
  it("maps a broadcast day to UTC for a fixed-offset zone", () => {
    const r = broadcastDayRange({ timezone: "Asia/Colombo", broadcastDayStartHour: 6 }, "2026-11-02");
    expect(r.start.toISOString()).toBe("2026-11-02T00:30:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-03T00:30:00.000Z");
  });

  it("has 23 hours on the spring-forward day and 25 on the fall-back day", () => {
    const ch = { timezone: "Europe/London", broadcastDayStartHour: 0 };
    const hours = (d: string) => {
      const r = broadcastDayRange(ch, d);
      return (r.end.getTime() - r.start.getTime()) / 3_600_000;
    };
    expect(hours("2026-03-29")).toBe(23);
    expect(hours("2026-10-25")).toBe(25);
    expect(hours("2026-11-02")).toBe(24);
  });

  it("assigns early-morning instants to the previous broadcast day", () => {
    const ch = { timezone: "Asia/Colombo", broadcastDayStartHour: 6 };
    expect(broadcastDateOf(ch, new Date("2026-11-02T22:00:00Z"))).toBe("2026-11-02"); // 03:30 local on the 3rd
    expect(broadcastDateOf(ch, new Date("2026-11-03T01:30:00Z"))).toBe("2026-11-03"); // 07:00 local
  });

  it("resolves wall-clock times in a zone", () => {
    expect(zonedToUtc("2026-07-01", "20:00", "Europe/London").toISOString()).toBe("2026-07-01T19:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "20:00", "Europe/London").toISOString()).toBe("2026-12-01T20:00:00.000Z");
  });

  it("parses and formats durations", () => {
    expect(parseDuration("00:30")).toBe(30);
    expect(parseDuration("1:30:00")).toBe(5400);
    expect(parseDuration("45")).toBe(45);
    expect(parseDuration("abc")).toBeNull();
    expect(formatDuration(5400)).toBe("1:30:00");
    expect(formatDuration(45)).toBe("00:45");
  });
});
