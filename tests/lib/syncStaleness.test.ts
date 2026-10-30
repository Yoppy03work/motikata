import { describe, expect, it } from "vitest";
import { isSyncStale, SYNC_STALE_MS } from "@/lib/syncStaleness";

const NOW = new Date("2026-10-30T04:00:00Z");

describe("isSyncStale", () => {
  it("12 時間以内なら止まっていない", () => {
    expect(isSyncStale(new Date(NOW.getTime() - 9 * 60 * 60 * 1000), NOW)).toBe(false);
    expect(isSyncStale(new Date(NOW.getTime() - SYNC_STALE_MS), NOW)).toBe(false);
  });

  it("12 時間を超えたら止まっている", () => {
    expect(isSyncStale(new Date(NOW.getTime() - SYNC_STALE_MS - 1), NOW)).toBe(true);
    expect(isSyncStale("2026-10-28T04:00:00Z", NOW)).toBe(true);
  });

  it("未同期や不正な値は警告しない", () => {
    expect(isSyncStale(null, NOW)).toBe(false);
    expect(isSyncStale("not-a-date", NOW)).toBe(false);
  });
});
