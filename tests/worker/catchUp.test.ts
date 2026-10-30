import { describe, expect, it } from "vitest";
import { latestSyncSlot, staleTargets } from "../../worker/catchUp";

// JST の時刻を UTC の Date にする
const jst = (s: string) => new Date(`${s}+09:00`);

describe("latestSyncSlot", () => {
  it("当日の直近の予定時刻を返す", () => {
    expect(latestSyncSlot(jst("2026-10-30T13:12:00"))).toEqual(jst("2026-10-30T13:00:00"));
    expect(latestSyncSlot(jst("2026-10-30T13:00:00"))).toEqual(jst("2026-10-30T13:00:00"));
    expect(latestSyncSlot(jst("2026-10-30T12:59:59"))).toEqual(jst("2026-10-30T04:00:00"));
    expect(latestSyncSlot(jst("2026-10-30T23:30:00"))).toEqual(jst("2026-10-30T19:00:00"));
  });

  it("4:00 より前は前日の 19:00", () => {
    expect(latestSyncSlot(jst("2026-10-30T03:59:00"))).toEqual(jst("2026-10-29T19:00:00"));
    // 月またぎ
    expect(latestSyncSlot(jst("2026-11-01T00:10:00"))).toEqual(jst("2026-10-31T19:00:00"));
  });
});

describe("staleTargets", () => {
  const slot = jst("2026-10-30T13:00:00");

  it("予定時刻より前の同期だけを取りこぼしとみなす", () => {
    expect(
      staleTargets(slot, {
        manaba: jst("2026-10-30T12:50:00").toISOString(),
        citPortal: jst("2026-10-30T13:00:09").toISOString(),
      }),
    ).toEqual({ manaba: true, citPortal: false });
  });

  it("未連携(null)は対象外", () => {
    expect(staleTargets(slot, { manaba: null, citPortal: null })).toEqual({
      manaba: false,
      citPortal: false,
    });
  });
});
