import { describe, expect, it } from "vitest";
import { computeClassDaysFromEvents } from "@/lib/classDays";

// JST 0:00 を表す UTC instant
function jstDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, -9, 0, 0));
}

function ymd(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe("computeClassDaysFromEvents", () => {
  // 前期だけの最小セットでテスト: 4/10〜5/10
  const baseEvents = [
    { title: "前期授業開始", date: jstDate(2026, 4, 10), kind: "EVENT" as const },
    { title: "前期授業終了", date: jstDate(2026, 5, 10), kind: "EVENT" as const },
  ];

  it("日曜は授業日でない", () => {
    const result = computeClassDaysFromEvents(baseEvents).map(ymd);
    // 4/12, 4/19, 4/26, 5/3, 5/10 は日曜
    expect(result).not.toContain("2026-04-12");
    expect(result).not.toContain("2026-04-19");
    expect(result).not.toContain("2026-04-26");
    expect(result).not.toContain("2026-05-03");
    expect(result).not.toContain("2026-05-10");
  });

  it("土曜は授業日扱い (CIT規定)", () => {
    const result = computeClassDaysFromEvents(baseEvents).map(ymd);
    // 4/11, 4/18, 4/25, 5/2, 5/9 は土曜
    expect(result).toContain("2026-04-11");
    expect(result).toContain("2026-04-18");
    expect(result).toContain("2026-04-25");
    expect(result).toContain("2026-05-02");
    expect(result).toContain("2026-05-09");
  });

  it("国民の祝日はデフォルトで授業日でない (GW 2026)", () => {
    const result = computeClassDaysFromEvents(baseEvents).map(ymd);
    // 4/29 (昭和の日), 5/3 (憲法記念日 + 日曜), 5/4 (みどりの日),
    // 5/5 (こどもの日), 5/6 (5/3振替) は祝日
    expect(result).not.toContain("2026-04-29");
    expect(result).not.toContain("2026-05-04");
    expect(result).not.toContain("2026-05-05");
    expect(result).not.toContain("2026-05-06");
  });

  it("『祝日授業日』と明示された日は祝日でも授業日になる", () => {
    const events = [
      ...baseEvents,
      // CIT 学年歴 PDF で 4/29 は「祝日授業日」と明示
      { title: "祝日授業日", date: jstDate(2026, 4, 29), kind: "EVENT" as const },
    ];
    const result = computeClassDaysFromEvents(events).map(ymd);
    expect(result).toContain("2026-04-29");
    // 他の祝日は依然として除外
    expect(result).not.toContain("2026-05-04");
    expect(result).not.toContain("2026-05-05");
  });

  it("HOLIDAY タイトルの日は授業日でない", () => {
    const events = [
      ...baseEvents,
      {
        title: "自学自習の日（休講）",
        date: jstDate(2026, 4, 30),
        kind: "HOLIDAY" as const,
      },
    ];
    const result = computeClassDaysFromEvents(events).map(ymd);
    expect(result).not.toContain("2026-04-30");
  });

  it("学期境界の外は対象にならない", () => {
    const result = computeClassDaysFromEvents(baseEvents).map(ymd);
    expect(result).not.toContain("2026-04-09");
    expect(result).not.toContain("2026-05-11");
  });
});
