import { describe, expect, it, vi } from "vitest";

// parsePingUrl は DB を使わないが、watchdog.ts が prisma を import するので差し替える
vi.mock("@/lib/db", () => ({ prisma: {} }));

const { buildMissedMessage, detectOutage, isLate } = await import("@/lib/missedReminders");
const { parsePingUrl } = await import("@/lib/watchdog");

// 2026-11-02 17:41 JST
const now = new Date("2026-11-02T08:41:00.000Z");

describe("detectOutage", () => {
  it("前回から 10 分以上空いていたら停止とみなす", () => {
    const last = new Date("2026-11-02T02:52:00.000Z");
    expect(detectOutage(last, now)).toEqual({ from: last, to: now });
  });

  it("数分の間隔は停止とみなさない", () => {
    expect(detectOutage(new Date(now.getTime() - 3 * 60_000), now)).toBeNull();
  });

  it("初回(記録なし)は停止とみなさない", () => {
    expect(detectOutage(null, now)).toBeNull();
  });
});

describe("isLate", () => {
  it("予定時刻から 10 分以上過ぎたら遅れ", () => {
    expect(isLate(new Date(now.getTime() - 10 * 60_000), now)).toBe(true);
    expect(isLate(new Date(now.getTime() - 9 * 60_000), now)).toBe(false);
  });
});

describe("buildMissedMessage", () => {
  const outage = { from: new Date("2026-11-02T02:52:00.000Z"), to: now };

  it("止まっていた時間と遅れた通知を 1 通にまとめる(同じタスクは 1 行)", () => {
    const msg = buildMissedMessage(
      outage,
      [
        { instanceId: 1, title: "情報と職業", dueAt: new Date("2026-11-02T14:59:00.000Z"), deadlinePassed: false },
        { instanceId: 1, title: "情報と職業", dueAt: new Date("2026-11-02T14:59:00.000Z"), deadlinePassed: false },
        { instanceId: 2, title: "メディア処理", dueAt: new Date("2026-11-03T00:00:00.000Z"), deadlinePassed: false },
      ],
      now,
    );
    expect(msg.title).toBe("アプリが止まっていたため、通知 2 件が遅れました");
    expect(msg.body.split("\n")).toEqual([
      "止まっていた時間: 11:52〜17:41(約 5 時間 49 分)",
      "・情報と職業(締切 23:59)",
      "・メディア処理(締切 11/3 09:00)",
    ]);
  });

  it("締切を過ぎた manaba 課題があれば要確認として先頭に出す", () => {
    const msg = buildMissedMessage(
      null,
      [
        { instanceId: 2, title: "メディア処理", dueAt: new Date("2026-11-03T00:00:00.000Z"), deadlinePassed: false },
        { instanceId: 3, title: "機械学習", dueAt: new Date("2026-11-02T02:00:00.000Z"), deadlinePassed: true },
      ],
      now,
    );
    expect(msg.title).toBe("【要確認】止まっている間に締切を過ぎた課題が 1 件あります");
    expect(msg.body.split("\n")[0]).toBe("・機械学習(締切 11:00 を過ぎました。manaba で提出を確認してください)");
  });

  it("11 件以上は「ほか N 件」に畳む", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      instanceId: i,
      title: `課題${i}`,
      dueAt: new Date(now.getTime() + (i + 1) * 3600_000),
      deadlinePassed: false,
    }));
    const lines = buildMissedMessage(null, items, now).body.split("\n");
    expect(lines).toHaveLength(11);
    expect(lines.at(-1)).toBe("ほか 2 件");
  });
});

describe("parsePingUrl", () => {
  it("healthchecks.io の Ping URL を受け付ける", () => {
    expect(parsePingUrl("https://hc-ping.com/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0").ok).toBe(true);
    expect(parsePingUrl(" https://hc-ping.com/abcDEF0123456789_-xy/mochikata ").ok).toBe(true);
  });

  it("それ以外のホストや形式は拒否する", () => {
    expect(parsePingUrl("http://hc-ping.com/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0").ok).toBe(false);
    expect(parsePingUrl("https://hc-ping.com.evil.example/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0").ok).toBe(false);
    expect(parsePingUrl("https://localhost:3000/api").ok).toBe(false);
    expect(parsePingUrl(42).ok).toBe(false);
  });
});
