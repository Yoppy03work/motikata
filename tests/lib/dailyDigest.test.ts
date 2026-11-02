import { describe, expect, it, vi } from "vitest";

// 純粋な関数だけを試す。モジュールが prisma を import するので差し替える
vi.mock("@/lib/db", () => ({ prisma: {} }));

const { DigestTimes, buildDigest, isDigestDue, latestDigestSlot } = await import("@/lib/dailyDigest");

// 2026-11-02(月) 21:05 JST
const now = new Date("2026-11-02T12:05:00.000Z");

describe("latestDigestSlot", () => {
  it("今日の過ぎた時刻のうち一番新しいもの", () => {
    expect(latestDigestSlot(["07:00", "21:00"], now)?.toISOString()).toBe("2026-11-02T12:00:00.000Z");
  });

  it("今日の時刻がまだなら昨日の最後の時刻", () => {
    const early = new Date("2026-11-02T00:30:00.000Z"); // 9:30 JST
    expect(latestDigestSlot(["21:00"], early)?.toISOString()).toBe("2026-11-01T12:00:00.000Z");
  });

  it("時刻が無ければ null", () => {
    expect(latestDigestSlot([], now)).toBeNull();
  });
});

describe("isDigestDue", () => {
  const slot = new Date("2026-11-02T12:00:00.000Z");

  it("未送信で予定時刻から 1 時間以内なら送る", () => {
    expect(isDigestDue(slot, new Date("2026-11-01T12:00:00.000Z"), now)).toBe(true);
    expect(isDigestDue(slot, null, now)).toBe(true);
  });

  it("送信済みなら送らない", () => {
    expect(isDigestDue(slot, slot, now)).toBe(false);
  });

  it("スリープ明けなどで 1 時間以上過ぎていたら送らない", () => {
    expect(isDigestDue(slot, null, new Date("2026-11-02T13:30:00.000Z"))).toBe(false);
  });
});

describe("buildDigest", () => {
  it("今日・明日・7 日以内に分けて件数をタイトルに出す", () => {
    const msg = buildDigest(
      [
        { title: "情報と職業", dueAt: new Date("2026-11-02T14:59:00.000Z") },
        { title: "メディア処理", dueAt: new Date("2026-11-03T00:00:00.000Z") },
        { title: "高性能計算", dueAt: new Date("2026-11-05T15:00:00.000Z") },
        { title: "データベース", dueAt: new Date("2026-11-06T15:05:00.000Z") },
        { title: "遠い課題", dueAt: new Date("2026-11-20T15:00:00.000Z") },
      ],
      now,
    );
    expect(msg?.title).toBe("締切まとめ: 今日 1 件・明日 1 件・7 日以内 2 件");
    expect(msg?.body.split("\n")).toEqual([
      "【今日】",
      "・23:59 情報と職業",
      "【明日】",
      "・09:00 メディア処理",
      "【7 日以内】",
      "・11/6(金) 00:00 高性能計算",
      "・11/7(土) 00:05 データベース",
    ]);
  });

  it("締切が近いものが無ければ null(送らない)", () => {
    expect(buildDigest([{ title: "遠い課題", dueAt: new Date("2026-11-20T15:00:00.000Z") }], now)).toBeNull();
  });
});

describe("DigestTimes", () => {
  it("重複を除いて時刻順に並べる", () => {
    expect(DigestTimes.parse(["21:00", "07:00", "21:00"])).toEqual(["07:00", "21:00"]);
  });

  it("不正な時刻は拒否する", () => {
    expect(DigestTimes.safeParse(["24:00"]).success).toBe(false);
    expect(DigestTimes.safeParse(["7:00"]).success).toBe(false);
  });
});
