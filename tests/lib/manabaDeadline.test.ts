import { describe, expect, it, vi } from "vitest";

// planDeadlineReminders / manabaUrlOf は DB を使わないが、モジュールが prisma を import するので差し替える
vi.mock("@/lib/db", () => ({ prisma: {} }));

const { manabaUrlOf, planDeadlineReminders } = await import("@/lib/manabaDeadline");

describe("planDeadlineReminders", () => {
  const due = new Date("2026-11-02T14:59:00.000Z");

  it("締切 60 分前と 5 分前を置く", () => {
    const now = new Date("2026-11-02T10:00:00.000Z");
    const out = planDeadlineReminders([{ id: 7, dueAt: due }], now);
    expect(out.map((p) => p.remindAt.toISOString())).toEqual([
      "2026-11-02T13:59:00.000Z",
      "2026-11-02T14:54:00.000Z",
    ]);
    expect(out[0].dedupeKey).toBe("manaba-due:7:2026-11-02T14:59:00.000Z:60");
  });

  it("もう過ぎた時刻の分は置かない", () => {
    const now = new Date("2026-11-02T14:30:00.000Z");
    const out = planDeadlineReminders([{ id: 7, dueAt: due }], now);
    expect(out.map((p) => p.dedupeKey)).toEqual(["manaba-due:7:2026-11-02T14:59:00.000Z:5"]);
  });

  it("締切が変わるとキーも変わる(古い分は同期時に消える)", () => {
    const now = new Date("2026-11-01T00:00:00.000Z");
    const a = planDeadlineReminders([{ id: 7, dueAt: due }], now)[0].dedupeKey;
    const b = planDeadlineReminders([{ id: 7, dueAt: new Date("2026-11-03T14:59:00.000Z") }], now)[0].dedupeKey;
    expect(a).not.toBe(b);
  });
});

describe("manabaUrlOf", () => {
  it("URL キーからだけ URL を取り出す", () => {
    expect(manabaUrlOf("manaba:url:https://cit.manaba.jp/ct/course_1_report_2")).toBe(
      "https://cit.manaba.jp/ct/course_1_report_2",
    );
    expect(manabaUrlOf("manaba:url:hash:abc")).toBeNull();
    expect(manabaUrlOf("manaba:コース:課題")).toBeNull();
    expect(manabaUrlOf(null)).toBeNull();
  });
});
